import React, { useMemo, useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { OzonStockRow } from '../types';
import { OzonSettingsModal } from './OzonSettingsModal';
import { buildOzonCoverage, OzonCoverageSettings, OzonClusterRef, OzonCoverageResult, ArticleCoverage, resolveOzonArticle } from '../lib/ozonCoverage';

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

  const [isOzonStocksCollapsed, setIsOzonStocksCollapsed] = useState(false);
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
  });
  const [clusterRefs, setClusterRefs] = useState<OzonClusterRef[]>([]);

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

  const coverage = useMemo<OzonCoverageResult | null>(() => {
    if (!ozonStocks || ozonStocks.length === 0) return null;
    const articleSet = new Set<string>();
    for (const s of ozonStocks) {
      if (s.offerId) articleSet.add(String(s.offerId));
    }
    const myStockAvailability: Record<string, number> = {};
    for (const s of skus) {
      myStockAvailability[s.sku] = getEffectiveAvailability(s.sku);
    }
    return buildOzonCoverage({
      stocks: ozonStocks,
      sales: ozonSales,
      skus,
      clusters: clusterRefs,
      settings: ozonSettings,
      myStockAvailability,
    });
  }, [ozonStocks, ozonSales, skus, kits, clusterRefs, ozonSettings, getEffectiveAvailability, rawStocks]);

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
      const stockRows = (ozonStocks || []).filter(
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
  }, [coverage, ozonStocks, skus, ozonSettings.minStockDays]);

  if (!isAdmin) return null;

  return (
    <div className="space-y-6 tab-enter">
      {/* Ozon Stocks Mirror Section */}
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
              <>
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
              </>
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
            {!coverageRows || coverageRows.length === 0 ? (
              <div className="bg-white p-6 rounded-2xl border border-slate-200 text-center text-sm text-slate-500" id="ozon-stocks-empty">
                Данных пока нет. Нажмите „Обновить", чтобы загрузить остатки со складов Ozon.
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm" id="ozon-stocks-table-container">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs" id="ozon-stocks-table">
                    <thead>
                      <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-semibold">
                        <th className="p-3 min-w-[220px]">Товар / Кластер / Склад</th>
                        <th className="p-3 text-right">Продано</th>
                        <th className="p-3 text-right">Скорость</th>
                        <th className="p-3 text-right">Доля</th>
                        <th className="p-3 text-right">Доступно</th>
                        <th className="p-3 text-right">Готовим</th>
                        <th className="p-3 text-right">В заявках</th>
                        <th className="p-3 text-right">В пути</th>
                        <th className="p-3 text-right">Излишки</th>
                        <th className="p-3 text-right">Возвраты</th>
                        <th className="p-3 text-right">Прочее</th>
                        <th className="p-3 text-right">Расчётный</th>
                        <th className="p-3 text-right">Покрытие</th>
                        <th className="p-3 text-right">Мой склад</th>
                        <th className="p-3 text-right">Рекомендация</th>
                      </tr>
                    </thead>
                    <tbody>
                      {coverageRows.map((art: any) => {
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
                              <td className="p-3 text-right font-semibold text-slate-800">{fmtInt(art.qtySold)}</td>
                              <td className="p-3 text-right font-semibold text-slate-800">{fmtSpeed(art.perDay)}</td>
                              <td className="p-3 text-right text-slate-300">—</td>
                              <td className={`p-3 text-right font-semibold ${art.totals.available === 0 ? 'text-slate-300' : 'text-slate-900'}`}>{fmtInt(art.totals.available)}</td>
                              <td className={`p-3 text-right ${art.totals.preparing === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(art.totals.preparing)}</td>
                              <td className={`p-3 text-right ${art.totals.requested === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(art.totals.requested)}</td>
                              <td className={`p-3 text-right ${art.totals.transit === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(art.totals.transit)}</td>
                              <td className={`p-3 text-right ${art.totals.excess === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(art.totals.excess)}</td>
                              <td className={`p-3 text-right ${art.totals.returns === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(art.totals.returns)}</td>
                              <td className={`p-3 text-right ${art.totals.other === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(art.totals.other)}</td>
                              <td className="p-3 text-right font-semibold text-slate-800">{fmtInt(art.totalEstimated)}</td>
                              <td className={`p-3 text-right ${coverageColor(art.coverageDays, ozonSettings.targetStockDays)}`}>{fmtDays(art.coverageDays, art.totalEstimated)}</td>
                              <td className="p-3 text-right text-slate-600">{fmtInt(art.myStockAvailable)}</td>
                              <td className="p-3 text-right">
                                {art.recommendedQty > 0 ? (
                                  <span className="text-indigo-600 font-bold">{fmtInt(art.recommendedQty)} шт</span>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
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
                                      </div>
                                    </td>
                                    <td className="p-2.5 text-right text-slate-700">{fmtInt(cls.qtySold)}</td>
                                    <td className="p-2.5 text-right text-slate-700">{fmtSpeed(cls.perDay)}</td>
                                    <td className="p-2.5 text-right text-slate-600">{cls.sharePct > 0 ? `${cls.sharePct.toFixed(1)}%` : '—'}</td>
                                    <td className={`p-2.5 text-right ${cls.available === 0 ? 'text-slate-300' : 'text-slate-800 font-medium'}`}>{fmtInt(cls.available)}</td>
                                    <td className="p-2.5 text-right text-slate-300">—</td>
                                    <td className="p-2.5 text-right text-slate-300">—</td>
                                    <td className={`p-2.5 text-right ${cls.transit === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(cls.transit)}</td>
                                    <td className="p-2.5 text-right text-slate-300">—</td>
                                    <td className={`p-2.5 text-right ${cls.returns === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(cls.returns)}</td>
                                    <td className="p-2.5 text-right text-slate-300">—</td>
                                    <td className="p-2.5 text-right font-medium text-slate-800">{fmtInt(cls.estimated)}</td>
                                    <td className={`p-2.5 text-right ${coverageColor(cls.coverageDays, ozonSettings.targetStockDays)}`}>{fmtDays(cls.coverageDays, cls.estimated)}</td>
                                    <td className="p-2.5 text-right text-slate-300">—</td>
                                    <td className="p-2.5 text-right">
                                      {cls.recommendation && cls.recommendation.boxes > 0 ? (
                                        <span className={cls.recommendation.limitedByMyStock ? 'text-amber-600 font-semibold' : 'text-indigo-600 font-semibold'}>
                                          {fmtInt(cls.recommendation.boxes)} кор ({fmtInt(cls.recommendation.qty)} шт)
                                        </span>
                                      ) : (
                                        <span className="text-slate-300">—</span>
                                      )}
                                    </td>
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
                                      <td className="p-2 text-right text-slate-300">—</td>
                                      <td className="p-2 text-right text-slate-300">—</td>
                                      <td className="p-2 text-right text-slate-300">—</td>
                                      <td className={`p-2 text-right ${(wh.available || 0) === 0 ? 'text-slate-300' : 'text-slate-700'}`}>{fmtInt(wh.available)}</td>
                                      <td className={`p-2 text-right ${(wh.preparing || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(wh.preparing)}</td>
                                      <td className={`p-2 text-right ${(wh.requested || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(wh.requested)}</td>
                                      <td className={`p-2 text-right ${(wh.transit || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(wh.transit)}</td>
                                      <td className={`p-2 text-right ${(wh.excess || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(wh.excess)}</td>
                                      <td className={`p-2 text-right ${(wh.returns || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(wh.returns)}</td>
                                      <td className={`p-2 text-right ${(wh.other || 0) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{fmtInt(wh.other)}</td>
                                      <td className="p-2 text-right text-slate-300">—</td>
                                      <td className="p-2 text-right text-slate-300">—</td>
                                      <td className="p-2 text-right text-slate-300">—</td>
                                      <td className="p-2 text-right text-slate-300">—</td>
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
                                <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundQtySold)}</td>
                                <td className="p-2.5 text-right text-slate-300">—</td>
                                <td className="p-2.5 text-right text-slate-300">—</td>
                                <td className="p-2.5 text-right text-slate-700">{fmtInt(art.unboundTotals.available)}</td>
                                <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundTotals.preparing)}</td>
                                <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundTotals.requested)}</td>
                                <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundTotals.transit)}</td>
                                <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundTotals.excess)}</td>
                                <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundTotals.returns)}</td>
                                <td className="p-2.5 text-right text-slate-600">{fmtInt(art.unboundTotals.other)}</td>
                                <td className="p-2.5 text-right font-medium text-slate-700">{fmtInt(art.unboundEstimated)}</td>
                                <td className="p-2.5 text-right text-slate-300">—</td>
                                <td className="p-2.5 text-right text-slate-300">—</td>
                                <td className="p-2.5 text-right text-slate-300">—</td>
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
          </div>
        )}
      </div>
      <OzonSettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
});
