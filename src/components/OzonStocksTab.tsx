import React, { useMemo, useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Columns3, HelpCircle, Maximize2, Minimize2, RefreshCw, Search, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { OzonStockRow, FactoryOrder } from '../types';
import { OzonSettingsModal } from './OzonSettingsModal';
import { FactoryOrderModal } from './FactoryOrderModal';
import { OzonSupplyModal } from './OzonSupplyModal';
import { buildOzonCoverage, OzonCoverageSettings, OzonClusterRef, OzonCoverageResult, resolveOzonArticle } from '../lib/ozonCoverage';
import { buildPendingSupplies } from '../lib/ozonPending';
import { getStatusDetails } from '../lib/ozonStatus';

const OZON_COLS_STORAGE_KEY = 'ozon_stocks_hidden_cols';

const OZON_TOGGLEABLE_COLS: { key: string; label: string }[] = [
  { key: 'sold', label: 'Продано' },
  { key: 'speed', label: 'Скорость' },
  { key: 'share', label: 'Доля' },
  { key: 'available', label: 'Доступно' },
  { key: 'preparing', label: 'Готовим' },
  { key: 'requested', label: 'В заявках' },
  { key: 'transit', label: 'В пути' },
  { key: 'excess', label: 'Излишки' },
  { key: 'returns', label: 'Возвраты' },
  { key: 'other', label: 'Прочее' },
  { key: 'estimated', label: 'Расчётный' },
  { key: 'coverage', label: 'Покрытие' },
  { key: 'pending', label: 'Зачёт' },
  { key: 'myStock', label: 'Мой склад' },
  { key: 'recommendation', label: 'Рекомендация' },
  { key: 'factory', label: 'Заказ на фабрике' },
];

const OZON_DEFAULT_HIDDEN_COLS = ['preparing', 'requested', 'excess', 'other'];

const ColHint: React.FC<{ text: string }> = ({ text }) => (
  <span className="relative inline-flex group align-middle ml-1">
    <HelpCircle size={12} className="text-slate-300 hover:text-indigo-500 cursor-help" />
    <span className="pointer-events-none absolute right-0 top-full mt-2 z-30 hidden group-hover:block w-64 bg-slate-800 text-white text-[11px] font-normal normal-case text-left rounded-xl px-3 py-2 shadow-lg leading-snug whitespace-normal">
      {text}
    </span>
  </span>
);

export const OzonStocksTab: React.FC = React.memo(() => {
  const currentUser = useWarehouseStore((state) => state.currentUser);
  const isAdmin = currentUser?.role?.toLowerCase() === 'admin' || ['admin', 'админ', 'администратор'].includes(currentUser?.username?.toLowerCase() || '');

  const ozonStocks = useWarehouseStore((state) => state.ozonStocks);
  const ozonStocksSyncIssues = useWarehouseStore((state) => state.ozonStocksSyncIssues);
  const fetchOzonStocks = useWarehouseStore((state) => state.fetchOzonStocks);
  const runOzonStocksSync = useWarehouseStore((state) => state.runOzonStocksSync);
  const fetchGas = useWarehouseStore((state) => state.fetchGas);
  const isProcessing = useWarehouseStore((state) => state.isProcessing);
  const ozonSales = useWarehouseStore((state) => state.ozonSales);
  const fetchOzonSales = useWarehouseStore((state) => state.fetchOzonSales);
  const skus = useWarehouseStore((state) => state.skus);
  const kits = useWarehouseStore((state) => state.kits);
  const getEffectiveAvailability = useWarehouseStore((state) => state.getEffectiveAvailability);
  const rawStocks = useWarehouseStore((state) => state.stock);
  const factoryOrders = useWarehouseStore((state) => state.factoryOrders);
  const fetchFactoryOrders = useWarehouseStore((state) => state.fetchFactoryOrders);
  const externalShipments = useWarehouseStore((state) => state.externalShipments);
  const fetchExternalShipments = useWarehouseStore((state) => state.fetchExternalShipments);
  const ozonSupplyRequests = useWarehouseStore((state) => state.ozonSupplyRequests);
  const fetchOzonSupplyRequests = useWarehouseStore((state) => state.fetchOzonSupplyRequests);

  const [showSettings, setShowSettings] = useState(false);
  const [expandedArticles, setExpandedArticles] = useState<Record<string, boolean>>({});
  const [expandedClusters, setExpandedClusters] = useState<Record<string, boolean>>({});
  const [ozonSettings, setOzonSettings] = useState<OzonCoverageSettings>({
    speedWeeks: 4,
    minStockDays: 7,
    targetStockDays: 30,
    factoryOrderDays: 60,
    returnsToSalePct: 80,
    excludedClusters: '',
    priorityClusters: '',
  });
  const [clusterRefs, setClusterRefs] = useState<OzonClusterRef[]>([]);
  const [supplySettings, setSupplySettings] = useState({
    maxBoxesPerCluster: 30,
    dropOffWarehouseId: '',
    dropOffWarehouseName: '',
    dropOffWarehouseType: '',
  });
  const [selectedSupply, setSelectedSupply] = useState<Record<string, boolean>>({});
  const [supplySummaryOpen, setSupplySummaryOpen] = useState(false);

  const supplyKey = (article: string, clusterId: string) => `${article}|||${clusterId}`;

  const toggleSupplyRow = (article: string, clusterId: string) => {
    const key = supplyKey(article, clusterId);
    setSelectedSupply((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  };

  const [cabinetFilter, setCabinetFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyWithRecommendations, setOnlyWithRecommendations] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [factoryModalArticle, setFactoryModalArticle] = useState<string | null>(null);
  const [pendingModalArticle, setPendingModalArticle] = useState<string | null>(null);
  const [showRecommendations, setShowRecommendations] = useState(false);

  const [showColsMenu, setShowColsMenu] = useState(false);
  const [hiddenCols, setHiddenCols] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(OZON_COLS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Ошибка чтения настроек колонок Ozon:', e);
    }
    return OZON_DEFAULT_HIDDEN_COLS;
  });

  const toggleCol = (key: string) => {
    setHiddenCols((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        localStorage.setItem(OZON_COLS_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.error('Ошибка сохранения настроек колонок Ozon:', e);
      }
      return next;
    });
  };

  const isColVisible = (key: string) => !hiddenCols.includes(key);

  const notifyCheckDone = useRef(false);

  useEffect(() => {
    if (notifyCheckDone.current) return;
    notifyCheckDone.current = true;

    async function checkNewClusters() {
      try {
        const res = await fetchGas('getOzonClusters');
        if (res?.status === 'success' && Array.isArray(res.data)) {
          const unnotified = res.data.filter((item: any) => item.notified === false);
          if (unnotified.length > 0) {
            const names = unnotified
              .map((item: any) => {
                const cid = String(item.clusterId || '').trim();
                const cname = String(item.clusterName || '').trim();
                return cname || `Кластер ${cid}`;
              })
              .join(', ');

            toast.info(`Новые кластеры Ozon: ${names}`, { duration: 10000 });
            await fetchGas('markOzonClustersNotified');
          }
        }
      } catch (err) {
        console.error('Ошибка проверки новых кластеров Ozon:', err);
      }
    }

    checkNewClusters();
  }, []);

  useEffect(() => {
    if (isAdmin) {
      fetchOzonStocks();
      fetchOzonSales();
      fetchFactoryOrders();
      fetchExternalShipments();
      fetchOzonSupplyRequests();
    }
  }, [isAdmin, fetchOzonStocks, fetchOzonSales, fetchFactoryOrders, fetchExternalShipments, fetchOzonSupplyRequests]);

  useEffect(() => {
    if (!isAdmin) return;
    fetchGas('getOzonSettings').then((res) => {
      if (res?.status === 'success' && res.data) {
        setOzonSettings({
          speedWeeks: Number(res.data.speedWeeks) || 4,
          minStockDays: Number(res.data.minStockDays) || 7,
          targetStockDays: Number(res.data.targetStockDays) || 30,
          factoryOrderDays: Number(res.data.factoryOrderDays) || 60,
          returnsToSalePct: Number(res.data.returnsToSalePct) || 80,
          excludedClusters: String(res.data.excludedClusters || ''),
          priorityClusters: String(res.data.priorityClusters || ''),
        });
        setSupplySettings({
          maxBoxesPerCluster: Number(res.data.maxBoxesPerCluster) || 30,
          dropOffWarehouseId: String(res.data.dropOffWarehouseId || ''),
          dropOffWarehouseName: String(res.data.dropOffWarehouseName || ''),
          dropOffWarehouseType: String(res.data.dropOffWarehouseType || ''),
        });
      }
    }).catch((err) => console.error('getOzonSettings error:', err));
    fetchGas('getOzonClusters').then((res) => {
      if (res?.status === 'success' && Array.isArray(res.data)) {
        setClusterRefs(res.data.map((item: any) => ({
          clusterId: String(item.clusterId || '').trim(),
          clusterName: String(item.clusterName || '').trim(),
        })).filter((item: any) => Boolean(item.clusterId)));
      }
    }).catch((err) => console.error('getOzonClusters error:', err));
  }, [isAdmin, fetchGas]);

  useEffect(() => {
    if (!showColsMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#ozon-columns-menu') && !target.closest('#btn-ozon-columns')) {
        setShowColsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showColsMenu]);

  useEffect(() => {
    if (!isFullscreen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isFullscreen]);

  const toggleArticle = (article: string) => {
    setExpandedArticles((prev) => ({ ...prev, [article]: !prev[article] }));
  };

  const toggleCluster = (key: string) => {
    setExpandedClusters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const fmtInt = (v: number | null | undefined) => Math.round(Number(v) || 0).toLocaleString('ru-RU');
  const fmtSpeed = (v: number | null | undefined) => (Number(v) || 0).toFixed(2);
  const fmtDays = (v: number | null | undefined, estimated: number) => {
    if (v === null || v === undefined) return estimated > 0 ? '∞' : '—';
    return `${Math.round(v)}`;
  };
  const coverageColor = (coverageDays: number | null | undefined, targetDays: number) => {
    if (coverageDays === null || coverageDays === undefined) return 'text-slate-400';
    if (coverageDays < 0) return 'text-red-600 font-bold';
    if (coverageDays < targetDays) return 'text-amber-600 font-semibold';
    return 'text-emerald-600 font-semibold';
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

  const ozonStocksCabinets = useMemo(() => {
    if (!ozonStocks || ozonStocks.length === 0) return [];
    return Array.from(new Set(ozonStocks.map(s => s.cabinet).filter(Boolean)));
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

  const filteredOzonStocks = useMemo(() => {
    if (!ozonStocks) return [];
    if (cabinetFilter === 'all') return ozonStocks;
    return ozonStocks.filter((s) => s.cabinet === cabinetFilter);
  }, [ozonStocks, cabinetFilter]);

  const filteredOzonSales = useMemo(() => {
    if (!ozonSales) return [];
    if (cabinetFilter === 'all') return ozonSales;
    return ozonSales.filter((s) => s.cabinet === cabinetFilter);
  }, [ozonSales, cabinetFilter]);

  // Локальный зачёт: товар из уже созданных заявок, который Ozon ещё не показал в «В заявках».
  // Фильтр по кабинету тот же, что у остатков и продаж, иначе заявки чужого кабинета
  // уменьшили бы потребность выбранного.
  const pendingSupplies = useMemo(() => {
    const shipments = cabinetFilter === 'all'
      ? (externalShipments || [])
      : (externalShipments || []).filter((s) => String(s.cabinet || '') === cabinetFilter);
    const requests = cabinetFilter === 'all'
      ? (ozonSupplyRequests || [])
      : (ozonSupplyRequests || []).filter((r) => String(r.cabinet || '') === cabinetFilter);
    return buildPendingSupplies({ shipments, requests, skus });
  }, [externalShipments, ozonSupplyRequests, skus, cabinetFilter]);

  // Названия кластеров по идентификатору — для расшифровки зачёта.
  const clusterNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of clusterRefs) {
      const id = String(c.clusterId || '').trim();
      if (id) map[id] = String(c.clusterName || '').trim();
    }
    return map;
  }, [clusterRefs]);

  // Строки расшифровки зачёта по товару, открытому в модалке.
  const pendingModalRows = useMemo(() => {
    if (!pendingModalArticle) return [];
    return pendingSupplies.details
      .filter((d) => d.article === pendingModalArticle)
      .sort((a, b) => String(b.since || '').localeCompare(String(a.since || '')));
  }, [pendingModalArticle, pendingSupplies]);

  const coverage = useMemo<OzonCoverageResult | null>(() => {
    if (filteredOzonStocks.length === 0) return null;
    const articleSet = new Set<string>();
    for (const s of filteredOzonStocks) {
      if (s.offerId) articleSet.add(String(s.offerId));
    }
    const myStockAvailability: Record<string, number> = {};
    for (const s of skus) {
      myStockAvailability[s.sku] = getEffectiveAvailability(s.sku);
    }
    return buildOzonCoverage({
      stocks: filteredOzonStocks,
      sales: filteredOzonSales,
      skus,
      clusters: clusterRefs,
      settings: ozonSettings,
      myStockAvailability,
      pending: pendingSupplies,
    });
  }, [filteredOzonStocks, filteredOzonSales, skus, kits, clusterRefs, ozonSettings, getEffectiveAvailability, rawStocks, pendingSupplies]);

  const coverageRows = useMemo(() => {
    if (!coverage || !coverage.articles) return [];
    const sumBy = (list: OzonStockRow[]) => ({
      available: list.reduce((s, w) => s + (w.available || 0), 0),
      preparing: list.reduce((s, w) => s + (w.preparing || 0), 0),
      requested: list.reduce((s, w) => s + (w.requested || 0), 0),
      transit: list.reduce((s, w) => s + (w.transit || 0), 0),
      excess: list.reduce((s, w) => s + (w.excess || 0), 0),
      returns: list.reduce((s, w) => s + (w.returns || 0), 0),
      other: list.reduce((s, w) => s + (w.other || 0), 0),
    });
    const rows = coverage.articles.map((art) => {
      const stockRows = filteredOzonStocks.filter(
        (s) => resolveOzonArticle(skus, s.offerId, s.sku) === art.article
      );
      const unboundRows = stockRows.filter((s) => !String(s.clusterId || '').trim());
      const artCoverageDays = art.perDay > 0
        ? (art.totalEstimated - art.perDay * ozonSettings.minStockDays) / art.perDay
        : null;
      const box = art.pcsPerBox > 0 ? art.pcsPerBox : 1;
      const clustersWithNeed = art.clusters.map((cls) => {
        const needBoxes = cls.recommendation ? Math.ceil(cls.recommendation.neededQty / box) : 0;
        return {
          ...cls,
          needBoxes,
          needQty: needBoxes * box,
          warehouses: stockRows.filter((s) => String(s.clusterId || '').trim() === cls.clusterId),
        };
      });
      return {
        ...art,
        name: stockRows.length > 0 ? (stockRows[0].name || '') : '',
        cabinets: Array.from(new Set(stockRows.map((s) => s.cabinet).filter(Boolean))),
        totals: sumBy(stockRows),
        unboundRows,
        unboundTotals: sumBy(unboundRows),
        coverageDays: artCoverageDays,
        recommendedQty: art.clusters.reduce((s, c) => s + (c.recommendation ? c.recommendation.qty : 0), 0),
        recLimited: art.clusters.some((c) => c.recommendation !== null && c.recommendation.limitedByMyStock),
        deficitQty: clustersWithNeed.reduce((s, c) => s + (c.recommendation && c.recommendation.boxes === 0 ? c.needQty : 0), 0),
        factoryDaysLeft: art.perDay > 0 ? (art.totalEstimated + Math.max(0, art.myStockAvailable)) / art.perDay : null,
        factoryThreshold: (Number(art.leadTimeDays) || 0) + ozonSettings.minStockDays,
        clusters: clustersWithNeed,
      };
    });
    rows.sort((a, b) => (b.perDay - a.perDay) || (b.totals.available - a.totals.available));
    return rows;
  }, [coverage, filteredOzonStocks, skus, ozonSettings.minStockDays]);

  const visibleRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return coverageRows.filter((row: any) => {
      if (onlyWithRecommendations && row.recommendedQty <= 0 && row.deficitQty <= 0 && !row.factory) return false;
      if (!q) return true;
      return String(row.article).toLowerCase().includes(q) || String(row.name || '').toLowerCase().includes(q);
    });
  }, [coverageRows, searchQuery, onlyWithRecommendations]);

  const clusterShares = useMemo(() => {
    const map: Record<string, { clusterName: string; qty: number; priority: boolean; priorityK: number }> = {};
    let total = 0;
    for (const row of coverageRows as any[]) {
      for (const cls of row.clusters) {
        if (!map[cls.clusterId]) {
          map[cls.clusterId] = { clusterName: cls.clusterName, qty: 0, priority: false, priorityK: 1 };
        }
        map[cls.clusterId].qty += cls.qtySold || 0;
        if (cls.priority) {
          map[cls.clusterId].priority = true;
          map[cls.clusterId].priorityK = cls.priorityK;
        }
        total += cls.qtySold || 0;
      }
    }
    const list = Object.values(map)
      .filter((c) => c.qty > 0)
      .map((c) => ({ ...c, pct: total > 0 ? (c.qty / total) * 100 : 0 }))
      .sort((a, b) => b.qty - a.qty);
    return { list, total };
  }, [coverageRows]);

  const fmtDateShort = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '');
  const fmtDateFull = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '—');

  const todayIso = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const activeFactoryOrders = useMemo(() => {
    const map: Record<string, FactoryOrder> = {};
    for (const o of factoryOrders || []) {
      if (String(o.status || '').trim() === 'received') continue;
      const key = String(o.article || '').trim();
      if (key) map[key] = o;
    }
    return map;
  }, [factoryOrders]);

  const factoryModalRow = useMemo(() => {
    if (!factoryModalArticle) return null;
    return (coverageRows as any[]).find((r) => r.article === factoryModalArticle) || null;
  }, [coverageRows, factoryModalArticle]);

  const supplyPlan = useMemo(() => {
    const rows: any[] = [];
    const boxesByCluster: Record<string, { clusterId: string; clusterName: string; boxes: number }> = {};
    const cabinets = new Set<string>();

    for (const row of coverageRows as any[]) {
      for (const c of row.clusters) {
        if (!c.recommendation || c.recommendation.boxes <= 0) continue;
        if (!selectedSupply[supplyKey(row.article, c.clusterId)]) continue;

        rows.push({
          article: row.article,
          name: row.name,
          clusterId: String(c.clusterId),
          clusterName: String(c.clusterName || ''),
          boxes: c.recommendation.boxes,
          qty: c.recommendation.qty,
          limitedByMyStock: c.recommendation.limitedByMyStock === true,
        });

        (row.cabinets || []).forEach((cab: string) => { if (cab) cabinets.add(cab); });

        const cid = String(c.clusterId);
        if (!boxesByCluster[cid]) {
          boxesByCluster[cid] = { clusterId: cid, clusterName: String(c.clusterName || ''), boxes: 0 };
        }
        boxesByCluster[cid].boxes += c.recommendation.boxes;
      }
    }

    const limit = Number(supplySettings.maxBoxesPerCluster) || 30;
    const overLimit = Object.values(boxesByCluster).filter((c) => c.boxes > limit);

    return {
      rows,
      clusters: Object.values(boxesByCluster),
      cabinets: Array.from(cabinets),
      totalBoxes: rows.reduce((s, r) => s + r.boxes, 0),
      totalQty: rows.reduce((s, r) => s + r.qty, 0),
      overLimit,
      limit,
    };
  }, [coverageRows, selectedSupply, supplySettings]);

  const recommendations = useMemo(() => {
    const supplies: any[] = [];
    const factories: any[] = [];
    let orderedCount = 0;
    for (const row of coverageRows as any[]) {
      const clusters = row.clusters.filter((c: any) => c.recommendation && (c.recommendation.boxes > 0 || c.needQty > 0));
      if (clusters.length > 0) {
        let minCoverage = Number.POSITIVE_INFINITY;
        for (const c of clusters) {
          const cov = c.coverageDays === null || c.coverageDays === undefined ? Number.POSITIVE_INFINITY : c.coverageDays;
          if (cov < minCoverage) minCoverage = cov;
        }
        supplies.push({
          article: row.article,
          name: row.name,
          myStockAvailable: row.myStockAvailable,
          freeMyStock: row.freeMyStock,
          pendingTotal: row.pendingTotal,
          minCoverage,
          clusters,
        });
      }
      if (row.factory) {
        if (activeFactoryOrders[row.article]) orderedCount++;
        else factories.push({ article: row.article, name: row.name, factory: row.factory, leadTimeDays: row.leadTimeDays });
      }
    }
    supplies.sort((a, b) => a.minCoverage - b.minCoverage);
    factories.sort((a, b) => a.factory.daysLeft - b.factory.daysLeft);
    return { supplies, factories, orderedCount };
  }, [coverageRows, activeFactoryOrders]);

  if (!isAdmin) return null;

  return (
    <div className="space-y-6 tab-enter">
      {/* Ozon Stocks Mirror Section */}
      <div className="space-y-4 bg-slate-50/50 p-6 rounded-3xl border border-slate-200/60 shadow-sm" id="ozon-stocks-mirror-section">
        <div
          className="flex justify-between items-center"
          id="ozon-stocks-header"
        >
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-bold text-slate-800">Остатки на складах Ozon</h3>
            {maxUpdatedAt && (
              <span className="text-xs text-slate-400 font-medium">
                Обновлено: {maxUpdatedAt}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              id="btn-ozon-fullscreen"
              onClick={() => setIsFullscreen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-white border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-xl transition-all shadow-xs"
            >
              <Maximize2 size={14} />
              Развернуть
            </button>
            <div className="relative">
              <button
                type="button"
                id="btn-ozon-columns"
                onClick={() => setShowColsMenu((prev) => !prev)}
                className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-white border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-xl transition-all shadow-xs"
              >
                <Columns3 size={14} />
                Колонки
              </button>
              {showColsMenu && (
                <div className="absolute right-0 mt-2 z-20 bg-white border border-slate-200 rounded-2xl shadow-lg p-3 w-56 max-h-80 overflow-y-auto" id="ozon-columns-menu">
                  <div className="text-[10px] uppercase tracking-wide font-bold text-slate-400 mb-2">Показывать колонки</div>
                  {OZON_TOGGLEABLE_COLS.map((col) => (
                    <label key={col.key} className="flex items-center gap-2 py-1 cursor-pointer text-xs text-slate-700 hover:text-slate-900">
                      <input
                        type="checkbox"
                        checked={isColVisible(col.key)}
                        onChange={() => toggleCol(col.key)}
                        className="rounded border-slate-300"
                      />
                      {col.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              id="btn-ozon-settings"
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-white border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-xl transition-all shadow-xs"
            >
              <Settings size={14} />
              Настройки
            </button>
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
          </div>
        </div>

        <div className="space-y-4" id="ozon-stocks-content">
            {ozonStocksSyncIssues.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 text-sm font-semibold" id="ozon-stocks-partial-warning">
                Данные неполные: не удалось обновить {ozonStocksSyncIssues.map(i => i.name).join(', ')}. Показаны последние успешно полученные данные по остальным кабинетам.
              </div>
            )}
            {ozonStocksCabinets.length > 0 && (
              <div className="text-xs text-slate-500 font-medium" id="ozon-stocks-cabinets-info">
                Данные по кабинетам: {ozonStocksCabinets.join(', ')}
              </div>
            )}
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

            {(recommendations.supplies.length > 0 || recommendations.factories.length > 0 || recommendations.orderedCount > 0) && (
              <div className="bg-white rounded-2xl border border-slate-200 p-4" id="ozon-recommendations">
                <button
                  type="button"
                  onClick={() => setShowRecommendations((v) => !v)}
                  className="w-full flex items-center justify-between text-left"
                >
                  <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    {showRecommendations ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                    Рекомендации
                  </span>
                  <span className="text-[11px] text-slate-400">
                    поставок: {recommendations.supplies.length} · заказов на фабрике: {recommendations.factories.length}
                  </span>
                </button>
                {showRecommendations && (
                  <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Отвезти на Ozon</div>

                      {supplyPlan.rows.length > 0 && (
                        <div className="mb-3 p-3 rounded-xl bg-indigo-50 border border-indigo-200">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="text-[11px] font-semibold text-indigo-900">
                              Выбрано: {supplyPlan.rows.length} строк · {fmtInt(supplyPlan.totalBoxes)} кор ({fmtInt(supplyPlan.totalQty)} шт) · кластеров: {supplyPlan.clusters.length}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setSelectedSupply({})}
                                className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-slate-600 hover:bg-slate-200 transition-colors"
                              >
                                Снять всё
                              </button>
                              <button
                                type="button"
                                id="btn-ozon-create-supply"
                                onClick={() => setSupplySummaryOpen(true)}
                                disabled={supplyPlan.cabinets.length > 1 || !supplySettings.dropOffWarehouseId}
                                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[11px] font-bold transition-colors"
                              >
                                Оформить поставку
                              </button>
                            </div>
                          </div>

                          {supplyPlan.cabinets.length > 1 && (
                            <div className="mt-2 text-[11px] font-semibold text-red-700">
                              Выбраны товары из разных кабинетов ({supplyPlan.cabinets.join(', ')}). Заявка создаётся в одном кабинете — отфильтруйте кабинет выше.
                            </div>
                          )}

                          {supplyPlan.overLimit.length > 0 && (
                            <div className="mt-2 text-[11px] font-semibold text-amber-700">
                              Превышен лимит {supplyPlan.limit} кор на кластер: {supplyPlan.overLimit.map((c: any) => `${c.clusterName} — ${c.boxes} кор`).join('; ')}. Остаток лучше оформить отдельной заявкой.
                            </div>
                          )}

                          {!supplySettings.dropOffWarehouseId && (
                            <div className="mt-2 text-[11px] font-semibold text-red-700">
                              Не выбрана точка отгрузки — укажите её в настройках Ozon.
                            </div>
                          )}
                        </div>
                      )}


                      {recommendations.supplies.length === 0 ? (
                        <div className="text-[11px] text-slate-400">Запасы кластеров в норме.</div>
                      ) : (
                        <div className="flex flex-col gap-3">
                          {recommendations.supplies.map((s: any) => (
                            <div key={s.article} className="border border-slate-100 rounded-xl p-3 bg-slate-50/60">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="font-mono font-bold text-slate-800 text-[12px]">{s.article}</span>
                                <span
                                  className="text-[11px] text-slate-400 shrink-0"
                                  title={s.pendingTotal > 0 ? `На складе всего ${fmtInt(s.myStockAvailable)} шт, из них ${fmtInt(s.pendingTotal)} шт зарезервировано под уже созданные заявки. Свободно для новых поставок ${fmtInt(s.freeMyStock)} шт.` : undefined}
                                >
                                  свободно {fmtInt(s.freeMyStock)} шт
                                  {s.pendingTotal > 0 && <span className="text-amber-500"> (из {fmtInt(s.myStockAvailable)})</span>}
                                </span>
                              </div>
                              {s.name && <div className="text-[11px] text-slate-500 truncate" title={s.name}>{s.name}</div>}
                              <div className="mt-2 flex flex-col gap-1">
                                {s.clusters.map((c: any) => (
                                  <div key={c.clusterId} className="flex items-center justify-between gap-2 text-[11px]">
                                    <span className="text-slate-600 truncate flex items-center gap-1.5" title={c.clusterName}>
                                      {c.recommendation.boxes > 0 && (
                                        <input
                                          type="checkbox"
                                          checked={Boolean(selectedSupply[supplyKey(s.article, c.clusterId)])}
                                          onChange={() => toggleSupplyRow(s.article, c.clusterId)}
                                          className="shrink-0 w-3.5 h-3.5 accent-indigo-600 cursor-pointer"
                                          title="Включить в заявку на поставку"
                                        />
                                      )}
                                      {c.clusterName}
                                      {c.priority && <span className="ml-1 text-amber-600 font-bold">×{c.priorityK}</span>}
                                    </span>
                                    {c.recommendation.boxes > 0 ? (
                                      <span className={`shrink-0 font-semibold ${c.recommendation.limitedByMyStock ? 'text-amber-600' : 'text-indigo-600'}`}>
                                        {fmtInt(c.recommendation.boxes)} кор ({fmtInt(c.recommendation.qty)} шт)
                                      </span>
                                    ) : (
                                      <span className="shrink-0 font-semibold text-red-600">
                                        нужно {fmtInt(c.needBoxes)} кор — нет на складе
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Заказать на фабрике</div>
                      {recommendations.factories.length === 0 ? (
                        <div className="text-[11px] text-slate-400">
                          {recommendations.orderedCount > 0
                            ? `Все сигналы закрыты размещёнными заказами: ${recommendations.orderedCount}.`
                            : 'Заказывать пока нечего.'}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {recommendations.factories.map((f: any) => (
                            <button
                              key={f.article}
                              type="button"
                              onClick={() => setFactoryModalArticle(f.article)}
                              className="text-left border border-rose-100 bg-rose-50/60 rounded-xl p-3 hover:bg-rose-50 transition-colors"
                            >
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="font-mono font-bold text-slate-800 text-[12px]">{f.article}</span>
                                <span className="text-rose-600 font-bold text-[12px] shrink-0">
                                  {fmtInt(f.factory.orderQty)} шт ({fmtInt(f.factory.orderBoxes)} кор)
                                </span>
                              </div>
                              {f.name && <div className="text-[11px] text-slate-500 truncate" title={f.name}>{f.name}</div>}
                              <div className="text-[11px] text-slate-500 mt-1">
                                Хватит на {Math.round(f.factory.daysLeft)} дн. · срок поставки {f.leadTimeDays || 0} дн. · {f.factory.reason === 'clusterDeficit' ? 'нечем пополнить кластеры' : 'кончается везде'}
                              </div>
                            </button>
                          ))}
                          {recommendations.orderedCount > 0 && (
                            <div className="text-[11px] text-emerald-700">Уже заказано на фабрике: {recommendations.orderedCount} товаров.</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Table / List */}
            <div className="bg-white rounded-2xl border border-slate-200 p-3 mb-3 flex flex-wrap items-center gap-3" id="ozon-stocks-filters">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  id="ozon-search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск по артикулу или названию"
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                />
              </div>
              {ozonStocksCabinets.length > 1 && (
                <select
                  id="ozon-cabinet-filter"
                  value={cabinetFilter}
                  onChange={(e) => setCabinetFilter(e.target.value)}
                  className="text-xs border border-slate-200 rounded-xl px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="all">Все кабинеты</option>
                  {ozonStocksCabinets.map((cab: string) => (
                    <option key={cab} value={cab}>{cab}</option>
                  ))}
                </select>
              )}
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none" id="ozon-only-rec-toggle">
                <input
                  type="checkbox"
                  checked={onlyWithRecommendations}
                  onChange={(e) => setOnlyWithRecommendations(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Только с рекомендациями
              </label>
              <span className="text-[11px] text-slate-400 ml-auto">
                Показано товаров: {visibleRows.length} из {coverageRows.length}
              </span>
            </div>

            {visibleRows.length === 0 ? (
              <div className="bg-white p-6 rounded-2xl border border-slate-200 text-center text-sm text-slate-500" id="ozon-stocks-empty">
                Данных пока нет. Нажмите „Обновить", чтобы загрузить остатки со складов Ozon.
              </div>
            ) : (
              <div
                className={`bg-white border border-slate-200 shadow-sm ${isFullscreen ? 'fixed inset-0 z-50 rounded-none overflow-hidden flex flex-col' : 'rounded-2xl overflow-hidden'}`}
                id="ozon-stocks-table-container"
              >
                {isFullscreen && (
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0">
                    <span className="text-sm font-bold text-slate-800">Остатки на складах Ozon</span>
                    <button
                      type="button"
                      id="btn-ozon-fullscreen-exit"
                      onClick={() => setIsFullscreen(false)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-white border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-xl transition-all"
                    >
                      <Minimize2 size={14} />
                      Свернуть (Esc)
                    </button>
                  </div>
                )}
                <div className={`overflow-auto ${isFullscreen ? 'flex-1 min-h-0' : 'max-h-[70vh]'}`}>
                  <style>{`
                    #ozon-stocks-table thead th {
                      position: sticky;
                      top: 0;
                      z-index: 20;
                      background-color: #f1f5f9;
                      box-shadow: inset 0 -1px 0 #e2e8f0;
                    }
                  `}</style>
                  <table className="w-full text-left border-collapse text-xs" id="ozon-stocks-table">
                    <thead>
                      <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-semibold">
                        <th className="p-3 min-w-[220px]">
                          Товар / Кластер / Склад
                          <ColHint text="Три уровня: строка товара — итог по всем складам Ozon; строка кластера — регион доставки; строка склада — конкретный склад Ozon внутри кластера. Нажми на строку, чтобы раскрыть уровень ниже." />
                        </th>
                        {isColVisible('sold') && (
                          <th className="p-3 text-right">
                            Продано
                            <ColHint text="Сколько штук продано за расчётное окно. Длина окна задаётся в настройках Ozon полем «Недель для расчёта скорости». Продажи берутся из отчёта Ozon, не из твоих отгрузок." />
                          </th>
                        )}
                        {isColVisible('speed') && (
                          <th className="p-3 text-right">
                            Скорость
                            <ColHint text="Средние продажи в штуках за день: продано за окно ÷ число дней окна. На этой скорости строятся покрытие и рекомендации." />
                          </th>
                        )}
                        {isColVisible('share') && (
                          <th className="p-3 text-right">
                            Доля
                            <ColHint text="Какую часть продаж товара даёт этот кластер. Показывает, куда реально уходит товар и где запас нужен в первую очередь." />
                          </th>
                        )}
                        {isColVisible('available') && (
                          <th className="p-3 text-right">
                            Доступно
                            <ColHint text="Товар лежит на складе Ozon и продаётся прямо сейчас." />
                          </th>
                        )}
                        {isColVisible('preparing') && (
                          <th className="p-3 text-right">
                            Готовим
                            <ColHint text="Ozon готовит товар к отгрузке покупателю: он уже зарезервирован и в продаже не участвует." />
                          </th>
                        )}
                        {isColVisible('requested') && (
                          <th className="p-3 text-right">
                            В заявках
                            <ColHint text="Товар заявлен к вывозу или перемещению по заявке в личном кабинете Ozon." />
                          </th>
                        )}
                        {isColVisible('transit') && (
                          <th className="p-3 text-right">
                            В пути
                            <ColHint text="Товар едет на склад Ozon и скоро встанет в продажу. Учитывается в расчётном остатке." />
                          </th>
                        )}
                        {isColVisible('excess') && (
                          <th className="p-3 text-right">
                            Излишки
                            <ColHint text="Товар, найденный складом Ozon сверх принятого количества. В расчётный остаток не входит." />
                          </th>
                        )}
                        {isColVisible('returns') && (
                          <th className="p-3 text-right">
                            Возвраты
                            <ColHint text="Возвраты от покупателей на складе Ozon. В расчётный остаток попадает не весь объём, а доля, заданная в настройках полем «% возвратов, возвращающихся в продажу»." />
                          </th>
                        )}
                        {isColVisible('other') && (
                          <th className="p-3 text-right">
                            Прочее
                            <ColHint text="Остальные состояния товара на складе Ozon: брак, утилизация, разбирательства. В расчётный остаток не входит." />
                          </th>
                        )}
                        {isColVisible('estimated') && (
                          <th className="p-3 text-right">
                            Расчётный
                            <ColHint text="На сколько штук реально можно рассчитывать: доступно + в пути + доля возвратов. Именно эта величина сравнивается с целевым запасом." />
                          </th>
                        )}
                        {isColVisible('coverage') && (
                          <th className="p-3 text-right">
                            Покрытие
                            <ColHint text="На сколько дней хватит расчётного остатка сверх неснижаемого запаса. Красный — запас уже ниже неснижаемого, жёлтый — ниже целевого, зелёный — норма. «∞» означает, что продаж нет, а остаток есть." />
                          </th>
                        )}
                        {isColVisible('pending') && (
                          <th className="p-3 text-right">
                            Зачёт
                            <ColHint text="Сколько штук уже едет по созданным заявкам на поставку. Эти штуки вычитаются из потребности сразу, не дожидаясь, пока Ozon отразит их в колонке «В заявках» — иначе один и тот же товар легко отправить дважды. По кластеру берётся наибольшее из двух чисел: нашего зачёта и колонки «В заявках» Ozon, потому что оба описывают одни и те же заявки. Зачёт снимается сам, когда заявка отменена, отклонена, просрочена или товар уже принят складом Ozon." />
                          </th>
                        )}
                        {isColVisible('myStock') && (
                          <th className="p-3 text-right">
                            Мой склад
                            <ColHint text="Сколько штук этого артикула свободно на твоём складе для НОВЫХ поставок. Это потолок рекомендации. Если часть остатка уже зарезервирована под созданные заявки, крупная цифра — свободный остаток, а под ней мелким шрифтом общий остаток и размер резерва. Резерв нужен, чтобы одну и ту же партию не порекомендовало отвезти второй раз в другой кластер. Для виртуальных комплектов остаток считается по компонентам." />
                          </th>
                        )}
                        {isColVisible('recommendation') && (
                          <th className="p-3 text-right">
                            Рекомендация
                            <ColHint text="Сколько отвезти в кластер, чтобы вернуть запас к целевому. Всегда кратно коробке. Синий — везём полностью, оранжевый — поставка урезана нехваткой на твоём складе, красный — потребность есть, но везти нечего: на складе пусто. У товара показана сумма по всем его кластерам." />
                          </th>
                        )}
                        {isColVisible('factory') && (
                          <th className="p-3 text-right">
                            Заказ на фабрике
                            <ColHint text="Сигнал «пора заказывать новую партию». Загорается по одной из двух причин: «кончается везде» — товара на Ozon и на твоём складе вместе хватит меньше, чем на срок поставки плюс неснижаемый запас; «нечем пополнить» — кластерам нужна поставка, а на твоём складе пусто, и перебросить остаток между кластерами Ozon нельзя. Объём заказа — больший из расчёта по настройке «Объём заказа на фабрике, дней» и непокрытой потребности кластеров. Наведи курсор на ячейку: там видно, на сколько дней хватит запаса и какой порог срабатывания." />
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((art: any) => {
                        const isArtExpanded = !!expandedArticles[art.article];
                        const factoryOrder = activeFactoryOrders[art.article] || null;
                        const factoryOverdue = !!(factoryOrder && factoryOrder.expectedAt && factoryOrder.expectedAt < todayIso);
                        const factoryBox = art.pcsPerBox > 0 ? art.pcsPerBox : 1;
                        return (
                          <React.Fragment key={art.article}>
                            {/* LEVEL 1: ARTICLE */}
                            <tr
                              className="border-b border-slate-200 bg-slate-100/80 hover:bg-slate-200/60 cursor-pointer transition-colors"
                              onClick={() => toggleArticle(art.article)}
                              id={`ozon-art-row-${art.article}`}
                            >
                              <td className="p-3 max-w-[350px]">
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {isArtExpanded ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
                                    {uniqueCabinetsCount > 1 && art.cabinets.map((cab: string) => (
                                      <span key={cab} className="text-[10px] px-1.5 py-0.5 rounded-md font-bold tracking-wide bg-indigo-50 text-indigo-600 border border-indigo-100">{cab}</span>
                                    ))}
                                    <span className="font-mono font-bold text-slate-800">{art.article}</span>
                                  </div>
                                  <span className="text-slate-500 truncate block text-[11px]" title={art.name}>{art.name}</span>
                                </div>
                              </td>
                              {isColVisible('sold') && <td className="p-3 text-right font-semibold text-slate-800">{fmtInt(art.qtySold)}</td>}
                              {isColVisible('speed') && <td className="p-3 text-right font-semibold text-slate-800">{fmtSpeed(art.perDay)}</td>}
                              {isColVisible('share') && <td className="p-3 text-right text-slate-300">—</td>}
                              {isColVisible('available') && <td className={`p-3 text-right font-semibold ${art.totals.available === 0 ? 'text-slate-300' : 'text-slate-900'}`}>{fmtInt(art.totals.available)}</td>}
                              {isColVisible('preparing') && <td className={`p-3 text-right ${art.totals.preparing === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(art.totals.preparing)}</td>}
                              {isColVisible('requested') && <td className={`p-3 text-right ${art.totals.requested === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(art.totals.requested)}</td>}
                              {isColVisible('transit') && <td className={`p-3 text-right ${art.totals.transit === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(art.totals.transit)}</td>}
                              {isColVisible('excess') && <td className={`p-3 text-right ${art.totals.excess === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(art.totals.excess)}</td>}
                              {isColVisible('returns') && <td className={`p-3 text-right ${art.totals.returns === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(art.totals.returns)}</td>}
                              {isColVisible('other') && <td className={`p-3 text-right ${art.totals.other === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(art.totals.other)}</td>}
                              {isColVisible('estimated') && <td className="p-3 text-right font-semibold text-slate-800">{fmtInt(art.totalEstimated)}</td>}
                              {isColVisible('coverage') && <td className={`p-3 text-right ${coverageColor(art.coverageDays, ozonSettings.targetStockDays)}`}>{fmtDays(art.coverageDays, art.totalEstimated)}</td>}
                              {isColVisible('pending') && (
                                <td className="p-3 text-right">
                                  {art.pendingTotal > 0 ? (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); setPendingModalArticle(art.article); }}
                                      className="font-semibold text-sky-600 hover:underline"
                                      title={`По этому товару уже создано заявок на ${fmtInt(art.pendingTotal)} шт. На это количество потребность уменьшена, и столько же зарезервировано на Моём складе. Нажми, чтобы посмотреть список заявок.`}
                                    >
                                      {fmtInt(art.pendingTotal)}
                                    </button>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </td>
                              )}
                              {isColVisible('myStock') && (
                                <td className="p-3 text-right">
                                  {art.pendingTotal > 0 ? (
                                    <span
                                      className="inline-flex flex-col items-end"
                                      title={`На складе всего ${fmtInt(art.myStockAvailable)} шт. Из них ${fmtInt(art.pendingTotal)} шт зарезервировано под уже созданные заявки на поставку. Для новых поставок свободно ${fmtInt(art.freeMyStock)} шт — это и есть потолок рекомендации.`}
                                    >
                                      <span className="font-semibold text-amber-600">{fmtInt(art.freeMyStock)}</span>
                                      <span className="text-[10px] text-slate-400 font-normal">из {fmtInt(art.myStockAvailable)} · резерв {fmtInt(art.pendingTotal)}</span>
                                    </span>
                                  ) : (
                                    <span className="text-slate-600">{fmtInt(art.myStockAvailable)}</span>
                                  )}
                                </td>
                              )}
                              {isColVisible('recommendation') && (
                                <td className="p-3 text-right">
                                  {art.recommendedQty > 0 ? (
                                    <span
                                      className={art.recLimited ? 'text-amber-600 font-bold' : 'text-indigo-600 font-bold'}
                                      title={art.recLimited ? 'Рекомендация урезана: на Моём складе не хватает товара на полную потребность' : undefined}
                                    >
                                      {fmtInt(art.recommendedQty)} шт
                                    </span>
                                  ) : art.deficitQty > 0 ? (
                                    <span className="text-red-600 font-bold" title="Кластерам нужна поставка, но на Моём складе нет товара">
                                      дефицит {fmtInt(art.deficitQty)} шт
                                    </span>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                  {art.recommendedQty > 0 && art.deficitQty > 0 && (
                                    <span className="block text-[10px] font-bold text-red-500" title="Часть кластеров осталась без поставки: на Моём складе не хватило товара">
                                      + дефицит {fmtInt(art.deficitQty)} шт
                                    </span>
                                  )}
                                </td>
                              )}
                              {isColVisible('factory') && (
                                <td className="p-3 text-right">
                                  {factoryOrder ? (
                                    <span className="relative inline-flex group justify-end">
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setFactoryModalArticle(art.article); }}
                                        className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition-colors ${factoryOverdue ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'}`}
                                      >
                                        {factoryOverdue ? `ждали ${fmtDateShort(factoryOrder.expectedAt)}` : `заказ · ${fmtDateShort(factoryOrder.expectedAt)}`}
                                      </button>
                                      <span className="pointer-events-none absolute right-0 top-full mt-1 z-30 hidden group-hover:block w-64 bg-slate-800 text-white text-[11px] font-normal normal-case text-left rounded-xl px-3 py-2 shadow-lg leading-snug whitespace-normal">
                                        Заказано {fmtInt(factoryOrder.qty)} шт ({fmtInt(Math.ceil(factoryOrder.qty / factoryBox))} кор)<br />
                                        Размещён: {fmtDateFull(factoryOrder.orderedAt)}<br />
                                        Ожидается: {fmtDateFull(factoryOrder.expectedAt)}{factoryOverdue ? ' — срок прошёл' : ''}<br />
                                        {factoryOrder.comment ? <>Комментарий: {factoryOrder.comment}<br /></> : null}
                                        {factoryOrder.user ? <>Отметил: {factoryOrder.user}<br /></> : null}
                                        Нажми, чтобы изменить заказ или отметить приход партии.
                                      </span>
                                    </span>
                                  ) : art.factory ? (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); setFactoryModalArticle(art.article); }}
                                      className="text-rose-600 font-bold text-right hover:underline"
                                      title={
                                        (art.factory.reason === 'clusterDeficit'
                                          ? `Кластерам нужна поставка на ${fmtInt(art.factory.unmetDeficitQty)} шт, а на Моём складе товара нет: между кластерами Ozon остаток не перебросить, взять можно только с фабрики. Общего запаса хватит на ${Math.round(art.factory.daysLeft)} дн. при сроке поставки ${art.leadTimeDays || 0} дн.`
                                          : `Товар кончается везде: общего запаса хватит на ${Math.round(art.factory.daysLeft)} дн. при пороге ${Math.round(art.factoryThreshold)} дн. (срок поставки ${art.leadTimeDays || 0} дн. + неснижаемый запас).`) + ' Нажми, чтобы отметить размещённый заказ.'
                                      }
                                    >
                                      {fmtInt(art.factory.orderQty)} шт
                                      <span className="block text-[10px] font-semibold text-rose-400">
                                        {fmtInt(art.factory.orderBoxes)} кор · {art.factory.reason === 'clusterDeficit' ? 'нечем пополнить' : 'кончается везде'}
                                      </span>
                                    </button>
                                  ) : (Number(art.leadTimeDays) || 0) === 0 ? (
                                    <span
                                      className="text-[10px] font-semibold text-slate-400"
                                      title="Не заполнена колонка «Срок поставки, дн» в SKU Базе. Пока она пуста, сигнал по общему остатку сработает только при падении ниже неснижаемого запаса."
                                    >
                                      срок не задан
                                    </span>
                                  ) : (
                                    <span
                                      className="text-slate-300"
                                      title={
                                        art.factoryDaysLeft === null
                                          ? 'Продаж за расчётное окно нет — сигнал не считается.'
                                          : `Заказ не нужен: запаса хватит на ${Math.round(art.factoryDaysLeft)} дн. при пороге ${Math.round(art.factoryThreshold)} дн., непокрытой потребности у кластеров нет.`
                                      }
                                    >
                                      —
                                    </span>
                                  )}
                                </td>
                              )}
                            </tr>

                            {/* LEVEL 2: CLUSTERS */}
                            {isArtExpanded && art.clusters.map((cls: any) => {
                              const clusterKey = `${art.article}:::${cls.clusterId}`;
                              const isClsExpanded = !!expandedClusters[clusterKey];
                              return (
                                <React.Fragment key={clusterKey}>
                                  <tr
                                    className="border-b border-slate-100 bg-slate-50/70 hover:bg-slate-100/60 cursor-pointer transition-colors"
                                    onClick={() => toggleCluster(clusterKey)}
                                    id={`ozon-cls-row-${art.article}-${cls.clusterId}`}
                                  >
                                    <td className="p-2.5 pl-8">
                                      <div className="flex items-center gap-1.5">
                                        {isClsExpanded ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
                                        <span className="font-semibold text-slate-700 text-[11px]">{cls.clusterName}</span>
                                        {cls.excluded && (
                                          <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-slate-200 text-slate-600">без поставок</span>
                                        )}
                                        {cls.priority && (
                                          <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-amber-100 text-amber-700" title="Приоритетный кластер: целевой и неснижаемый запас умножены на коэффициент">
                                            приоритет ×{cls.priorityK}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    {isColVisible('sold') && <td className="p-2.5 text-right text-slate-700">{fmtInt(cls.qtySold)}</td>}
                                    {isColVisible('speed') && <td className="p-2.5 text-right text-slate-700">{fmtSpeed(cls.perDay)}</td>}
                                    {isColVisible('share') && <td className="p-2.5 text-right text-slate-600">{cls.sharePct > 0 ? `${cls.sharePct.toFixed(1)}%` : '—'}</td>}
                                    {isColVisible('available') && <td className={`p-2.5 text-right ${cls.available === 0 ? 'text-slate-300' : 'text-slate-800 font-medium'}`}>{fmtInt(cls.available)}</td>}
                                    {isColVisible('preparing') && <td className="p-2.5 text-right text-slate-300">—</td>}
                                    {isColVisible('requested') && <td className="p-2.5 text-right text-slate-300">—</td>}
                                    {isColVisible('transit') && <td className={`p-2.5 text-right ${cls.transit === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(cls.transit)}</td>}
                                    {isColVisible('excess') && <td className="p-2.5 text-right text-slate-300">—</td>}
                                    {isColVisible('returns') && <td className={`p-2.5 text-right ${cls.returns === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(cls.returns)}</td>}
                                    {isColVisible('other') && <td className="p-2.5 text-right text-slate-300">—</td>}
                                    {isColVisible('estimated') && <td className="p-2.5 text-right font-medium text-slate-800">{fmtInt(cls.estimated)}</td>}
                                    {isColVisible('coverage') && <td className={`p-2.5 text-right ${coverageColor(cls.coverageDays, ozonSettings.targetStockDays)}`}>{fmtDays(cls.coverageDays, cls.estimated)}</td>}
                                    {isColVisible('pending') && (
                                      <td className="p-2.5 text-right">
                                        {cls.pendingEffective > 0 ? (
                                          <span className="font-medium text-sky-600" title={`Потребность кластера уменьшена на ${fmtInt(cls.pendingEffective)} шт. Наш зачёт по созданным заявкам: ${fmtInt(cls.pendingQty)} шт. Колонка «В заявках» у Ozon: ${fmtInt(cls.requestedQty)} шт. Берём наибольшее из двух, а не сумму — это одни и те же заявки.`}>
                                            {fmtInt(cls.pendingEffective)}
                                          </span>
                                        ) : (
                                          <span className="text-slate-300">—</span>
                                        )}
                                      </td>
                                    )}
                                    {isColVisible('myStock') && <td className="p-2.5 text-right text-slate-300">—</td>}
                                    {isColVisible('recommendation') && (
                                      <td className="p-2.5 text-right">
                                        {cls.recommendation && cls.recommendation.boxes > 0 ? (
                                          <span
                                            className={cls.recommendation.limitedByMyStock ? 'text-amber-600 font-semibold' : 'text-indigo-600 font-semibold'}
                                            title={cls.recommendation.limitedByMyStock ? `Урезано остатком Моего склада: полная потребность ${fmtInt(cls.needQty)} шт` : undefined}
                                          >
                                            {fmtInt(cls.recommendation.boxes)} кор ({fmtInt(cls.recommendation.qty)} шт)
                                          </span>
                                        ) : cls.recommendation && cls.needQty > 0 ? (
                                          <span className="text-red-600 font-semibold" title="Кластеру нужна поставка, но на Моём складе нет товара">
                                            нужно {fmtInt(cls.needBoxes)} кор ({fmtInt(cls.needQty)} шт)
                                            <span className="block text-[10px] font-bold text-red-400">нет на складе</span>
                                          </span>
                                        ) : (
                                          <span className="text-slate-300">—</span>
                                        )}
                                      </td>
                                    )}
                                    {isColVisible('factory') && <td className="p-2.5 text-right text-slate-300">—</td>}
                                  </tr>

                                  {/* LEVEL 3: WAREHOUSES */}
                                  {isClsExpanded && cls.warehouses.map((wh: OzonStockRow, idx: number) => (
                                    <tr
                                      key={`${clusterKey}-wh-${idx}`}
                                      className="border-b border-slate-100/50 bg-white hover:bg-slate-50 transition-colors"
                                      id={`ozon-wh-row-${art.article}-${cls.clusterId}-${idx}`}
                                    >
                                      <td className="p-2 pl-14">
                                        <div className="flex items-center gap-1.5">
                                          {uniqueCabinetsCount > 1 && (
                                            <span className="text-[10px] px-1 py-0.5 rounded font-bold bg-slate-100 text-slate-500">{wh.cabinet}</span>
                                          )}
                                          <span className="text-slate-600 text-[11px]">{wh.warehouseName}</span>
                                        </div>
                                      </td>
                                      {isColVisible('sold') && <td className="p-2 text-right text-slate-300">—</td>}
                                      {isColVisible('speed') && <td className="p-2 text-right text-slate-300">—</td>}
                                      {isColVisible('share') && <td className="p-2 text-right text-slate-300">—</td>}
                                      {isColVisible('available') && <td className={`p-2 text-right ${(wh.available || 0) === 0 ? 'text-slate-300' : 'text-slate-700'}`}>{fmtInt(wh.available)}</td>}
                                      {isColVisible('preparing') && <td className={`p-2 text-right ${(wh.preparing || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(wh.preparing)}</td>}
                                      {isColVisible('requested') && <td className={`p-2 text-right ${(wh.requested || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(wh.requested)}</td>}
                                      {isColVisible('transit') && <td className={`p-2 text-right ${(wh.transit || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(wh.transit)}</td>}
                                      {isColVisible('excess') && <td className={`p-2 text-right ${(wh.excess || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(wh.excess)}</td>}
                                      {isColVisible('returns') && <td className={`p-2 text-right ${(wh.returns || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(wh.returns)}</td>}
                                      {isColVisible('other') && <td className={`p-2 text-right ${(wh.other || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(wh.other)}</td>}
                                      {isColVisible('estimated') && <td className="p-2 text-right text-slate-300">—</td>}
                                      {isColVisible('coverage') && <td className="p-2 text-right text-slate-300">—</td>}
                                      {isColVisible('pending') && <td className="p-2 text-right text-slate-300">—</td>}
                                      {isColVisible('myStock') && <td className="p-2 text-right text-slate-300">—</td>}
                                      {isColVisible('recommendation') && <td className="p-2 text-right text-slate-300">—</td>}
                                      {isColVisible('factory') && <td className="p-2 text-right text-slate-300">—</td>}
                                    </tr>
                                  ))}
                                </React.Fragment>
                              );
                            })}

                            {/* LEVEL 2: UNBOUND (без кластера) */}
                            {isArtExpanded && art.unboundRows.length > 0 && (
                              <tr className="border-b border-slate-100 bg-slate-50/70" id={`ozon-unbound-row-${art.article}`}>
                                <td className="p-2.5 pl-8">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-semibold text-slate-500 text-[11px]">Без кластера (агрегат)</span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-slate-200 text-slate-600">не в рекомендациях</span>
                                  </div>
                                </td>
                                {isColVisible('sold') && <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundQtySold)}</td>}
                                {isColVisible('speed') && <td className="p-2.5 text-right text-slate-300">—</td>}
                                {isColVisible('share') && <td className="p-2.5 text-right text-slate-300">—</td>}
                                {isColVisible('available') && <td className="p-2.5 text-right text-slate-700">{fmtInt(art.unboundTotals.available)}</td>}
                                {isColVisible('preparing') && <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundTotals.preparing)}</td>}
                                {isColVisible('requested') && <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundTotals.requested)}</td>}
                                {isColVisible('transit') && <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundTotals.transit)}</td>}
                                {isColVisible('excess') && <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundTotals.excess)}</td>}
                                {isColVisible('returns') && <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundTotals.returns)}</td>}
                                {isColVisible('other') && <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundTotals.other)}</td>}
                                {isColVisible('estimated') && <td className="p-2.5 text-right font-medium text-slate-700">{fmtInt(art.unboundEstimated)}</td>}
                                {isColVisible('coverage') && <td className="p-2.5 text-right text-slate-300">—</td>}
                                {isColVisible('pending') && (
                                  <td className="p-2.5 text-right">
                                    {(pendingSupplies.unboundByArticle[art.article] || 0) > 0 ? (
                                      <span className="text-slate-600" title="Заявки, у которых Ozon не вернул кластер. В кластерные рекомендации они не идут, но в общий зачёт по товару входят.">
                                        {fmtInt(pendingSupplies.unboundByArticle[art.article] || 0)}
                                      </span>
                                    ) : (
                                      <span className="text-slate-300">—</span>
                                    )}
                                  </td>
                                )}
                                {isColVisible('myStock') && <td className="p-2.5 text-right text-slate-300">—</td>}
                                {isColVisible('recommendation') && <td className="p-2.5 text-right text-slate-300">—</td>}
                                {isColVisible('factory') && <td className="p-2.5 text-right text-slate-300">—</td>}
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {clusterShares.list.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-4 mt-3" id="ozon-cluster-shares">
                <div className="text-xs font-bold text-slate-700 mb-3">
                  Доли кластеров в продажах
                  <span className="font-normal text-slate-400 ml-2">всего продано: {fmtInt(clusterShares.total)} шт</span>
                </div>
                <div className="flex flex-col gap-2">
                  {clusterShares.list.map((c) => (
                    <div key={c.clusterName} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 flex items-center gap-1.5 overflow-hidden">
                        <span className="text-[11px] text-slate-600 truncate" title={c.clusterName}>{c.clusterName}</span>
                        {c.priority && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-amber-100 text-amber-700 shrink-0" title="Приоритетный кластер: целевой и неснижаемый запас умножены на коэффициент">
                            ×{c.priorityK}
                          </span>
                        )}
                      </span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(100, c.pct)}%` }} />
                      </div>
                      <span className="text-[11px] font-semibold text-slate-700 w-14 text-right">{c.pct.toFixed(1)}%</span>
                      <span className="text-[11px] text-slate-400 w-16 text-right">{fmtInt(c.qty)} шт</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
      </div>
      <OzonSettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <OzonSupplyModal
        isOpen={supplySummaryOpen && supplyPlan.rows.length > 0}
        onClose={() => setSupplySummaryOpen(false)}
        rows={supplyPlan.rows}
        cabinet={supplyPlan.cabinets.length === 1 ? supplyPlan.cabinets[0] : (cabinetFilter !== 'all' ? cabinetFilter : '')}
        dropOffWarehouseId={supplySettings.dropOffWarehouseId}
        dropOffWarehouseName={supplySettings.dropOffWarehouseName}
        dropOffWarehouseType={supplySettings.dropOffWarehouseType}
        onCreated={() => setSelectedSupply({})}
      />
      {factoryModalArticle && (
        <FactoryOrderModal
          isOpen={true}
          onClose={() => setFactoryModalArticle(null)}
          article={factoryModalArticle}
          productName={factoryModalRow ? factoryModalRow.name : ''}
          suggestedQty={factoryModalRow && factoryModalRow.factory ? factoryModalRow.factory.orderQty : 0}
          pcsPerBox={factoryModalRow ? factoryModalRow.pcsPerBox : 1}
          leadTimeDays={factoryModalRow ? factoryModalRow.leadTimeDays : 0}
          order={activeFactoryOrders[factoryModalArticle] || null}
        />
      )}
      {pendingModalArticle && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setPendingModalArticle(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-3xl mt-16 p-5"
            onClick={(e) => e.stopPropagation()}
            id="ozon-pending-modal"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <div className="text-sm font-bold text-slate-800">Расшифровка зачёта</div>
                <div className="text-[11px] text-slate-500 font-mono">{pendingModalArticle}</div>
              </div>
              <button
                type="button"
                onClick={() => setPendingModalArticle(null)}
                className="text-slate-400 hover:text-slate-700 text-lg leading-none px-2"
              >
                ✕
              </button>
            </div>
            <div className="text-[11px] text-slate-500 bg-slate-50 rounded-xl p-3 mb-3 leading-snug">
              Эти заявки уже созданы, поэтому их количества вычтены из потребности и зарезервированы на Моём складе. Зачёт снимется сам, когда заявка будет отменена, отклонена, просрочена или товар примет склад Ozon. Если статус получить не удалось, зачёт истечёт через 7 дней от даты в колонке «С какого числа».
            </div>
            {pendingModalRows.length === 0 ? (
              <div className="text-[11px] text-slate-400">По этому товару активных заявок нет.</div>
            ) : (
              <table className="w-full text-left text-[11px] border-collapse">
                <thead>
                  <tr className="text-slate-500 font-semibold border-b border-slate-200">
                    <th className="py-2 pr-2">Кластер</th>
                    <th className="py-2 pr-2 text-right">Штук</th>
                    <th className="py-2 pr-2">Статус</th>
                    <th className="py-2 pr-2">С какого числа</th>
                    <th className="py-2 pr-2">Заявка</th>
                    <th className="py-2">Откуда</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingModalRows.map((d, idx) => (
                    <tr key={`${d.orderId}-${d.clusterId}-${idx}`} className="border-b border-slate-100">
                      <td className="py-2 pr-2 text-slate-700">{d.clusterId ? (clusterNameById[d.clusterId] || d.clusterId) : 'Без кластера'}</td>
                      <td className="py-2 pr-2 text-right font-semibold text-slate-800">{fmtInt(d.qty)}</td>
                      <td className="py-2 pr-2">
                        <span className={`px-1.5 py-0.5 rounded-md font-semibold ${getStatusDetails(d.ozonStatus).badgeClass}`}>
                          {getStatusDetails(d.ozonStatus).label}
                        </span>
                      </td>
                      <td className="py-2 pr-2 text-slate-500">{fmtDateFull(d.since)}</td>
                      <td className="py-2 pr-2 text-slate-500 font-mono">{d.orderId || '—'}</td>
                      <td className="py-2 text-slate-400">{d.source === 'shipment' ? 'данные Ozon' : 'журнал заявок'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold text-slate-800">
                    <td className="py-2 pr-2">Итого</td>
                    <td className="py-2 pr-2 text-right">{fmtInt(pendingModalRows.reduce((s, d) => s + d.qty, 0))}</td>
                    <td colSpan={4}></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
