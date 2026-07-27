import React, { useMemo, useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Columns3, HelpCircle, RefreshCw, Search, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { OzonStockRow } from '../types';
import { OzonSettingsModal } from './OzonSettingsModal';
import { buildOzonCoverage, OzonCoverageSettings, OzonClusterRef, OzonCoverageResult, resolveOzonArticle } from '../lib/ozonCoverage';

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
  { key: 'myStock', label: 'Мой склад' },
  { key: 'recommendation', label: 'Рекомендация' },
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

  const [cabinetFilter, setCabinetFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyWithRecommendations, setOnlyWithRecommendations] = useState(false);

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
    }
  }, [isAdmin, fetchOzonStocks, fetchOzonSales]);

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
    });
  }, [filteredOzonStocks, filteredOzonSales, skus, kits, clusterRefs, ozonSettings, getEffectiveAvailability, rawStocks]);

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
      return {
        ...art,
        name: stockRows.length > 0 ? (stockRows[0].name || '') : '',
        cabinets: Array.from(new Set(stockRows.map((s) => s.cabinet).filter(Boolean))),
        totals: sumBy(stockRows),
        unboundRows,
        unboundTotals: sumBy(unboundRows),
        coverageDays: artCoverageDays,
        recommendedQty: art.clusters.reduce((s, c) => s + (c.recommendation ? c.recommendation.qty : 0), 0),
        clusters: art.clusters.map((cls) => ({
          ...cls,
          warehouses: stockRows.filter((s) => String(s.clusterId || '').trim() === cls.clusterId),
        })),
      };
    });
    rows.sort((a, b) => (b.perDay - a.perDay) || (b.totals.available - a.totals.available));
    return rows;
  }, [coverage, filteredOzonStocks, skus, ozonSettings.minStockDays]);

  const visibleRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return coverageRows.filter((row: any) => {
      if (onlyWithRecommendations && row.recommendedQty <= 0) return false;
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
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm" id="ozon-stocks-table-container">
                <div className="overflow-x-auto">
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
                        {isColVisible('myStock') && (
                          <th className="p-3 text-right">
                            Мой склад
                            <ColHint text="Свободный остаток этого артикула на твоём складе. Это потолок поставки: рекомендация не может превышать то, что есть в наличии. Для виртуальных комплектов — доступность по компонентам." />
                          </th>
                        )}
                        {isColVisible('recommendation') && (
                          <th className="p-3 text-right">
                            Рекомендация
                            <ColHint text="Сколько отвезти в кластер, чтобы вернуть запас к целевому. Всегда кратно коробке. Оранжевый цвет означает, что поставка урезана нехваткой на твоём складе. У товара показана сумма по всем его кластерам." />
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((art: any) => {
                        const isArtExpanded = !!expandedArticles[art.article];
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
                              {isColVisible('myStock') && <td className="p-3 text-right text-slate-600">{fmtInt(art.myStockAvailable)}</td>}
                              {isColVisible('recommendation') && (
                                <td className="p-3 text-right">
                                  {art.recommendedQty > 0 ? (
                                    <span className="text-indigo-600 font-bold">{fmtInt(art.recommendedQty)} шт</span>
                                  ) : (
                                    <span className="text-slate-300">—</span>
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
                                    {isColVisible('myStock') && <td className="p-2.5 text-right text-slate-300">—</td>}
                                    {isColVisible('recommendation') && (
                                      <td className="p-2.5 text-right">
                                        {cls.recommendation && cls.recommendation.boxes > 0 ? (
                                          <span className={cls.recommendation.limitedByMyStock ? 'text-amber-600 font-semibold' : 'text-indigo-600 font-semibold'}>
                                            {fmtInt(cls.recommendation.boxes)} кор ({fmtInt(cls.recommendation.qty)} шт)
                                          </span>
                                        ) : (
                                          <span className="text-slate-300">—</span>
                                        )}
                                      </td>
                                    )}
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
                                      {isColVisible('myStock') && <td className="p-2 text-right text-slate-300">—</td>}
                                      {isColVisible('recommendation') && <td className="p-2 text-right text-slate-300">—</td>}
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
                                {isColVisible('myStock') && <td className="p-2.5 text-right text-slate-300">—</td>}
                                {isColVisible('recommendation') && <td className="p-2.5 text-right text-slate-300">—</td>}
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
    </div>
  );
});
