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
  X,
  Columns3
} from 'lucide-react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { DashSettingsModal } from './DashSettingsModal';
import { formatCurrency, calcCostDebt, hasCostDebt } from '../lib/utils';
import { STATUS_FUNNEL_ORDER, getStatusDetails } from '../lib/ozonStatus';
import { buildOzonAlerts, buildCoverageAlerts, buildReserveShortageAlerts, OzonAlert } from '../lib/ozonAlerts';
import { buildOzonCoverage, resolveOzonArticle, OzonCoverageSettings, OzonClusterRef, OzonCoverageResult } from '../lib/ozonCoverage';
import { buildPendingSupplies } from '../lib/ozonPending';

// Колонки таблицы остатков, которые можно скрывать. «Артикул» скрыть нельзя — это опора строки.
const DASH_TOGGLEABLE_COLS: { key: string; label: string }[] = [
  { key: 'quantity', label: 'Кол-во' },
  { key: 'free', label: 'Свободно' },
  { key: 'avgCost', label: 'Себест. (сред.)' },
  { key: 'capitalization', label: 'Капитализация' },
  { key: 'storage', label: 'Хранение ₽/сут' },
  { key: 'turnover', label: 'Оборач. (дни)' },
];

// По умолчанию скрыт учётный остаток: пользователю важнее свободный остаток за вычетом резерва.
const DASH_DEFAULT_HIDDEN_COLS = ['quantity'];

// Чтение числовой настройки Ozon с сервера. Не использовать `Number(value) || fallback` —
// ноль является законным значением настройки, а `||` считает его ложью и подменяет умолчанием.
const numSetting = (value: unknown, fallback: number): number => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

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
  const ozonStocks = useWarehouseStore((state) => state.ozonStocks);
  const ozonSales = useWarehouseStore((state) => state.ozonSales);
  const factoryOrders = useWarehouseStore((state) => state.factoryOrders);
  // Item 26 stage A1: these three reads are now part of the composite start-up call.
  // The store still exposes them individually — other screens refresh with them.
  const fetchOzonInitialData = useWarehouseStore((state) => state.fetchOzonInitialData);
  const ozonSupplyRequests = useWarehouseStore((state) => state.ozonSupplyRequests);
  const fetchOzonSupplyRequests = useWarehouseStore((state) => state.fetchOzonSupplyRequests);
  const getEffectiveAvailability = useWarehouseStore((state) => state.getEffectiveAvailability);
  const lastPurchasePrices = useWarehouseStore((state) => state.lastPurchasePrices);
  const fetchLastPurchasePrices = useWarehouseStore((state) => state.fetchLastPurchasePrices);
  const fetchGas = useWarehouseStore((state) => state.fetchGas);
  
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

  // Скрытие колонок таблицы остатков. Настройка своя у каждого пользователя.
  const [showColsMenu, setShowColsMenu] = useState(false);
  const [hiddenCols, setHiddenCols] = useState<string[]>(DASH_DEFAULT_HIDDEN_COLS);

  useEffect(() => {
    if (!currentUser?.username) return;
    try {
      const saved = localStorage.getItem(`dashCols_${currentUser.username}`);
      setHiddenCols(saved ? JSON.parse(saved) : DASH_DEFAULT_HIDDEN_COLS);
    } catch (e) {
      setHiddenCols(DASH_DEFAULT_HIDDEN_COLS);
    }
  }, [currentUser?.username]);

  const toggleCol = (key: string) => {
    setHiddenCols((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      if (currentUser?.username) {
        try {
          localStorage.setItem(`dashCols_${currentUser.username}`, JSON.stringify(next));
        } catch (e) {}
      }
      return next;
    });
  };

  const isColVisible = (key: string) => !hiddenCols.includes(key);
  const visibleColsCount = 1 + DASH_TOGGLEABLE_COLS.filter((c) => isColVisible(c.key)).length;

  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('ozon_dismissedAlerts');
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  });

  const [ozonSettings, setOzonSettings] = useState<OzonCoverageSettings>({
    speedWeeks: 4,
    minStockDays: 7,
    targetStockDays: 30,
    factoryOrderDays: 60,
    returnsToSalePct: 80,
    excludedClusters: '',
    priorityClusters: '',
    deficitDays: 7,
    trendWeeks: 13,
    bestWeeks: 4,
    minSalesForCorrection: 50,
    maxSpeedGrowth: 5,
    salesGrowthPct: 0,
  });
  const [clusterRefs, setClusterRefs] = useState<OzonClusterRef[]>([]);

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

  useEffect(() => {
    if (!isAdmin) return;
    const timer = setTimeout(() => {
      // Item 26 stage A1 (2026-08-20): Ozon stocks, sales, factory orders, settings and cluster
      // references now arrive in ONE composite call instead of five. Each round trip to Apps Script
      // costs 2-4 s no matter how little it carries, so the old wave was as slow as its slowest
      // member. getLastPurchasePrices stays separate on purpose: it still goes through the switch
      // and takes the global lock, and folding it in would have changed that silently.
      fetchLastPurchasePrices();
      fetchOzonInitialData().then((res: any) => {
        if (res?.settings) {
          setOzonSettings({
            // Счётчик недель, ноль бессмысленен — нижняя граница 1.
            speedWeeks: Math.max(1, numSetting(res.settings.speedWeeks, 4)),
            minStockDays: numSetting(res.settings.minStockDays, 7),
            targetStockDays: numSetting(res.settings.targetStockDays, 30),
            maxClusterDays: numSetting(res.settings.maxClusterDays, 100),
            factoryOrderDays: numSetting(res.settings.factoryOrderDays, 60),
            returnsToSalePct: numSetting(res.settings.returnsToSalePct, 80),
            excludedClusters: String(res.settings.excludedClusters || ''),
            priorityClusters: String(res.settings.priorityClusters || ''),
            deficitDays: numSetting(res.settings.deficitDays, 7),
            // Счётчик недель, ноль бессмысленен — нижняя граница 1.
            trendWeeks: Math.max(1, numSetting(res.settings.trendWeeks, 13)),
            // Счётчик недель, ноль бессмысленен — нижняя граница 1.
            bestWeeks: Math.max(1, numSetting(res.settings.bestWeeks, 4)),
            minSalesForCorrection: numSetting(res.settings.minSalesForCorrection, 50),
            maxSpeedGrowth: numSetting(res.settings.maxSpeedGrowth, 5),
            salesGrowthPct: numSetting(res.settings.salesGrowthPct, 0),
          });
        }
        if (Array.isArray(res?.clusters)) {
          setClusterRefs(res.clusters.map((item: any) => ({
            clusterId: String(item.clusterId || '').trim(),
            clusterName: String(item.clusterName || '').trim(),
          })).filter((item: any) => Boolean(item.clusterId)));
        }
      }).catch((err: any) => console.error('getOzonInitialData error:', err));
    }, 1200);
    return () => clearTimeout(timer);
  }, [isAdmin, fetchOzonInitialData, fetchLastPurchasePrices]);

  // Локальный зачёт: товар из уже созданных заявок, который Ozon ещё не показал в «В заявках».
  // На главной кабинеты не разделяются — берутся все записи.
  const pendingSupplies = useMemo(() => {
    return buildPendingSupplies({
      shipments: externalShipments || [],
      requests: ozonSupplyRequests || [],
      skus,
    });
  }, [externalShipments, ozonSupplyRequests, skus]);

  // Пункт 35. ТРУБА: сумма активных заказов на фабрике по артикулу.
  // Просроченный заказ (дата ожидания раньше сегодняшней) в ТРУБУ НЕ входит:
  // фабрика сроки сорвала, считать этот товар имеющимся нельзя.
  // Объявлено ДО расчёта покрытия: расчёт этими данными пользуется.
  const factoryOnOrder = useMemo(() => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const map: Record<string, number> = {};
    for (const o of factoryOrders || []) {
      if (String(o.status || '').trim() === 'received') continue;
      const key = String(o.article || '').trim();
      if (!key) continue;
      const expected = String(o.expectedAt || '').trim();
      if (expected && expected < today) continue;
      map[key] = (map[key] || 0) + (Number(o.qty) || 0);
    }
    return map;
  }, [factoryOrders]);

  const ozonCoverage = useMemo<OzonCoverageResult | null>(() => {
    if (!isAdmin) return null;
    if (!ozonStocks || ozonStocks.length === 0) return null;
    const myStockAvailability: Record<string, number> = {};
    for (const s of skus) {
      myStockAvailability[s.sku] = getEffectiveAvailability(s.sku);
    }
    return buildOzonCoverage({
      stocks: ozonStocks,
      sales: ozonSales || [],
      skus,
      clusters: clusterRefs,
      settings: ozonSettings,
      myStockAvailability,
      pending: pendingSupplies,
      factoryOnOrder,
      kits,
    });
  }, [isAdmin, ozonStocks, ozonSales, skus, kits, stock, clusterRefs, ozonSettings, getEffectiveAvailability, pendingSupplies, factoryOnOrder]);

  const coverageAlerts = useMemo(() => {
    if (!isAdmin || !ozonCoverage) return [];
    const orderedArticles = (factoryOrders || [])
      .filter((o) => String(o.status || '').trim() !== 'received')
      .map((o) => String(o.article || '').trim())
      .filter(Boolean);
    const namesByArticle: Record<string, string> = {};
    for (const s of ozonStocks || []) {
      const art = resolveOzonArticle(skus, s.offerId, s.sku);
      if (art && !namesByArticle[art] && s.name) {
        namesByArticle[art] = s.name;
      }
    }
    const all = buildCoverageAlerts(ozonCoverage, ozonSettings, namesByArticle);
    const hidden = new Set(dismissedAlerts);
    return all.filter((a) => !hidden.has(a.key));
  }, [isAdmin, ozonCoverage, factoryOrders, ozonStocks, skus, ozonSettings, dismissedAlerts]);

  // Алерт «заявка больше остатка»: состав заявки могли изменить в Ozon Seller,
  // и резерв под заявки стал больше доступного остатка склада.
  // Приложение исправить это не может — заявку правит пользователь в Ozon Seller.
  const reserveShortageAlerts = useMemo(() => {
    if (!isAdmin) return [];

    // В сравнение идут только артикулы из справочника SKU: нераспознанные позиции
    // заявки дали бы ложную нехватку, потому что остатка по ним нет по определению
    const knownArticles = new Set(skus.map((s) => s.sku));
    const reservedByArticle: Record<string, number> = {};
    for (const article of Object.keys(pendingSupplies.byArticle)) {
      if (knownArticles.has(article)) {
        reservedByArticle[article] = pendingSupplies.byArticle[article];
      }
    }

    const availableByArticle: Record<string, number> = {};
    for (const s of skus) {
      availableByArticle[s.sku] = getEffectiveAvailability(s.sku);
    }

    const namesByArticle: Record<string, string> = {};
    for (const s of ozonStocks || []) {
      const art = resolveOzonArticle(skus, s.offerId, s.sku);
      if (art && !namesByArticle[art] && s.name) {
        namesByArticle[art] = s.name;
      }
    }

    const all = buildReserveShortageAlerts({
      reservedByArticle,
      availableByArticle,
      namesByArticle,
    });
    const hidden = new Set(dismissedAlerts);
    return all.filter((a) => !hidden.has(a.key));
  }, [isAdmin, skus, ozonStocks, pendingSupplies, dismissedAlerts, getEffectiveAvailability]);

  const alerts = useMemo(() => {
    if (!isAdmin) return [];
    const all = buildOzonAlerts(externalShipments || [], skus || []);
    const hidden = new Set(dismissedAlerts);
    const shipmentAlerts = all.filter(a => !hidden.has(a.key));
    return [...reserveShortageAlerts, ...shipmentAlerts, ...coverageAlerts];
  }, [isAdmin, externalShipments, skus, dismissedAlerts, coverageAlerts, reserveShortageAlerts]);

  useEffect(() => {
    // «Внешние отгрузки» грузим всем: по ним строится резерв под заявки в колонке «Свободно».
    // Журнал «Заявки Ozon» требует прав администратора, поэтому он только для админа.
    fetchExternalShipments();
    if (isAdmin) {
      fetchOzonSupplyRequests();
    }
  }, [isAdmin, fetchExternalShipments, fetchOzonSupplyRequests]);

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
                } else if (alert.severity === 'sky') {
                  severityClasses = 'bg-sky-50 border-sky-200 text-sky-800';
                  titleClasses = 'text-sky-800';
                } else if (alert.severity === 'orange') {
                  severityClasses = 'bg-orange-50 border-orange-200 text-orange-800';
                  titleClasses = 'text-orange-800';
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
                        onClick={() => setActiveTab(alert.type === 'supply_needed' || alert.type === 'factory_order' ? 'ozonStocks' : 'ozon')}
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

      <div className="flex justify-end mb-2 relative">
        <button
          type="button"
          onClick={() => setShowColsMenu((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 hover:bg-slate-50 transition-colors"
        >
          <Columns3 size={14} /> Колонки
        </button>
        {showColsMenu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowColsMenu(false)} />
            <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-xl shadow-lg p-2 w-60">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1">Показывать колонки</div>
              {DASH_TOGGLEABLE_COLS.map((col) => (
                <label key={col.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={isColVisible(col.key)}
                    onChange={() => toggleCol(col.key)}
                    className="accent-indigo-600"
                  />
                  {col.label}
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/50 border-b border-slate-200">
              <th className="px-6 py-4 font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('article')}>
                Артикул {getSortIcon('article')}
              </th>
              {isColVisible('quantity') && (
              <th className="px-6 py-4 font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('quantity')}>
                Кол-во {getSortIcon('quantity')}
              </th>
              )}
              {isColVisible('free') && (
              <th className="px-6 py-4 font-semibold text-slate-600 text-right group">
                <div className="flex items-center justify-end gap-1">
                  Свободно
                  <span title="Сколько штук этого артикула свободно для новых поставок: остаток минус то, что уже зарезервировано под созданные заявки на Ozon. Резерв нужен, чтобы одну и ту же партию не отправить дважды. Колонка «Кол-во» остаётся фактическим учётным остатком и на резерв не уменьшается — по ней считается капитализация."><HelpCircle size={14} className="text-slate-400 group-hover:text-indigo-500" /></span>
                </div>
              </th>
              )}
              {isColVisible('avgCost') && (
              <th className="px-6 py-4 font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('avgCost')}>
                <div className="flex items-center justify-end gap-1">
                  Себест. (сред.) 
                  <span title="Средняя стоимость единицы товара на основе всех приходов"><HelpCircle size={14} className="text-slate-400 group-hover:text-indigo-500" /></span>
                  {getSortIcon('avgCost')}
                </div>
              </th>
              )}
              {isColVisible('capitalization') && (
              <th className="px-6 py-4 font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('capitalization')}>
                <div className="flex items-center justify-end gap-1">
                  Капитализация 
                  <span title="Общая стоимость остатков данного артикула на складе"><HelpCircle size={14} className="text-slate-400 group-hover:text-indigo-500" /></span>
                  {getSortIcon('capitalization')}
                </div>
              </th>
              )}
              {isColVisible('storage') && (
              <th className="px-6 py-4 font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('storageCost')}>
                <div className="flex items-center justify-end gap-1">
                  Хранение ₽/сут
                  <span title="Стоимость хранения остатка данного артикула в сутки (кол-во x литраж x ставка)"><HelpCircle size={14} className="text-slate-400 group-hover:text-indigo-500" /></span>
                  {getSortIcon('storageCost')}
                </div>
              </th>
              )}
              {isColVisible('turnover') && (
              <th className="px-6 py-4 font-semibold text-slate-600 text-center cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('turnover')}>
                <div className="flex items-center justify-center gap-1">
                  Оборач. (дни) 
                  <span title="Примерное время до полного истощения запаса на основе последних отгрузок"><HelpCircle size={14} className="text-slate-400 group-hover:text-indigo-500" /></span>
                  {getSortIcon('turnover')}
                </div>
              </th>
              )}
            </tr>
          </thead>
          <tbody>
            {isSyncing && sortedStock.length === 0 ? (
              // Skeleton loading placeholder
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-100 animate-pulse">
                  <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                  {isColVisible('quantity') && <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-16 ml-auto"></div></td>}
                  {isColVisible('free') && <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-16 ml-auto"></div></td>}
                  {isColVisible('avgCost') && <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-20 ml-auto"></div></td>}
                  {isColVisible('capitalization') && <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24 ml-auto"></div></td>}
                  {isColVisible('storage') && <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-20 ml-auto"></div></td>}
                  {isColVisible('turnover') && <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-16 mx-auto"></div></td>}
                </tr>
              ))
            ) : sortedStock.length === 0 ? (
              // Empty state indicating no data
              <tr>
                <td colSpan={visibleColsCount} className="px-6 py-16 text-center">
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
                {isColVisible('quantity') && (
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
                )}
                {isColVisible('free') && (
                <td className="px-6 py-4 text-right">
                  {(() => {
                    const reserved = pendingSupplies.byArticle[item.article] || 0;
                    const free = Math.max(0, (item as any).quantity - reserved);
                    if (reserved <= 0) {
                      return (
                        <div className="inline-flex flex-col items-end">
                          <span
                            className={`px-2 py-1 rounded-md font-bold ${free < (Number(lowStockThreshold) || 0) ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-700'}`}
                            title={`Свободно ${free} шт. Заявок на поставку Ozon по этому артикулу сейчас нет.`}
                          >
                            {free}
                          </span>
                          {(item as any).isVirtual && (
                            <span className="text-[9px] text-violet-500 font-bold uppercase tracking-wider mt-0.5 mr-0.5">
                              сборка
                            </span>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div
                        className="inline-flex flex-col items-end"
                        title={`На складе ${(item as any).quantity} шт. Из них ${reserved} шт зарезервировано под уже созданные заявки на поставку Ozon. Свободно для новых поставок ${free} шт.`}
                      >
                        <span className="px-2 py-1 rounded-md font-bold bg-amber-50 text-amber-700">{free}</span>
                        <span className="text-[10px] text-slate-400 mt-0.5">резерв {reserved}</span>
                      </div>
                    );
                  })()}
                </td>
                )}
                {isColVisible('avgCost') && <td className="px-6 py-4 text-right font-medium whitespace-nowrap">{formatCurrency(item.avgCost)} ₽</td>}
                {isColVisible('capitalization') && (
                  <td className="px-6 py-4 text-right font-bold text-slate-900 whitespace-nowrap">
                    {formatCurrency(item.capitalization)} ₽
                    {(() => {
                      // Пункт 40, этап E. Долг показан прямо под суммой капитализации — там, где
                      // владелец на него и смотрит. Только показ: ни одно сохранённое число не меняется.
                      const qty = Number((item as any).quantity) || 0;
                      const lastPrice = lastPurchasePrices[item.article]?.price;
                      if (!hasCostDebt(qty, item.capitalization, lastPrice)) return null;
                      const debt = calcCostDebt(qty, item.capitalization, lastPrice);
                      const avgPerUnit = qty > 0 ? item.capitalization / qty : item.capitalization;
                      const comparison = lastPrice
                        ? ` Средняя сейчас ${formatCurrency(avgPerUnit)} ₽/шт против ${formatCurrency(lastPrice)} ₽/шт по последнему приходу.`
                        : ' Товара на остатке нет, а капитализация осталась.';
                      return (
                        <span
                          className="block mt-1 text-[10px] font-bold text-amber-700 whitespace-nowrap"
                          title={`Списанный брак уменьшает количество, но не уменьшает капитализацию, поэтому себестоимость списанного товара осталась висеть на артикуле. Она уже подняла среднюю себестоимость, а при следующем приходе размажется по новой партии.${comparison}`}
                        >
                          в том числе долг {formatCurrency(debt)} ₽
                        </span>
                      );
                    })()}
                  </td>
                )}
                {isColVisible('storage') && (
                <td className="px-6 py-4 text-right font-medium whitespace-nowrap text-slate-700">
                  {(() => {
                    const skuData = skus.find(s => s.sku === item.article);
                    const liters = skuData ? skuData.volumeLiters : 0;
                    const cost = liters > 0 && storageRatePerLiterDay > 0 ? item.quantity * liters * storageRatePerLiterDay : 0;
                    return `${formatCurrency(cost)} ₽`;
                  })()}
                </td>
                )}
                {isColVisible('turnover') && (
                <td className="px-6 py-4 text-center">
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden max-w-[80px] mx-auto">
                    <div className="bg-indigo-500 h-full" style={{ width: `${Math.min(item.turnover, 100)}%` }}></div>
                  </div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase mt-1 block">{item.turnover} дн.</span>
                </td>
                )}
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
