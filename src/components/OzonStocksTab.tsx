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

  const fmtInt = (v: number | null | undefined) => (v && v > 0 ? v.toLocaleString('ru-RU') : '—');
  const fmtSpeed = (v: number | null | undefined) => (v && v > 0 ? v.toFixed(1) : '—');
  const fmtDays = (v: number | null | undefined) => (v !== null && v !== undefined ? `${Math.round(v)} дн.` : '—');

  const coverageColor = (coverageDays: number | null, minDays: number, targetDays: number) => {
    if (coverageDays === null) return 'text-slate-400';
    if (coverageDays < minDays) return 'text-red-600 font-bold';
    if (coverageDays <= targetDays) return 'text-amber-600 font-semibold';
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
    return coverage.articles.map((art) => {
      const artCoverageDays = art.perDay > 0
        ? (art.totalEstimated - art.perDay * ozonSettings.minStockDays) / art.perDay
        : null;

      const artRecommendedQty = art.clusters.reduce(
        (sum, c) => sum + (c.recommendation?.qty || 0),
        0
      );

      const clustersWithDetails = art.clusters.map((cls) => {
        const clsRecommendedQty = cls.recommendation?.qty || 0;

        const warehouses = (ozonStocks || []).filter((s) => {
          const matchArt = resolveOzonArticle(skus, s.offerId, s.sku) === art.article;
          const matchCls = String(s.clusterId || '').trim() === cls.clusterId;
          return matchArt && matchCls;
        });

        return {
          ...cls,
          recommendedQty: clsRecommendedQty,
          warehouses,
        };
      });

      return {
        ...art,
        coverageDays: artCoverageDays,
        recommendedQty: artRecommendedQty,
        factory: art.factory
          ? { ...art.factory, neededQty: art.factory.orderQty }
          : { neededQty: 0 },
        clusters: clustersWithDetails,
      };
    });
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
                        <th className="p-3 text-right">Продажи шт/дн</th>
                        <th className="p-3 text-right">Доступно</th>
                        <th className="p-3 text-right">В пути</th>
                        <th className="p-3 text-right">В заявках</th>
                        <th className="p-3 text-right">Покрытие, дн</th>
                        <th className="p-3 text-right">Реком. Ozon</th>
                        <th className="p-3 text-right">Мой склад</th>
                        <th className="p-3 text-right">Заказ Завод</th>
                      </tr>
                    </thead>
                    <tbody>
                      {coverageRows.map((art: any) => {
                        const isArtExpanded = !!expandedArticles[art.article];

                        return (
                          <React.Fragment key={art.article}>
                            {/* LEVEL 1: ARTICLE ROW */}
                            <tr
                              className="border-b border-slate-200 bg-slate-100/80 hover:bg-slate-200/60 cursor-pointer font-semibold transition-colors"
                              onClick={() => toggleArticle(art.article)}
                              id={`ozon-art-row-${art.article}`}
                            >
                              <td className="p-3">
                                <div className="flex items-center gap-2">
                                  {isArtExpanded ? <ChevronDown size={16} className="text-slate-500" /> : <ChevronRight size={16} className="text-slate-500" />}
                                  <span className="font-mono text-sm font-bold text-slate-800">{art.article}</span>
                                </div>
                              </td>
                              <td className="p-3 text-right font-medium text-slate-700">{fmtSpeed(art.perDay)}</td>
                              <td className="p-3 text-right font-bold text-slate-900">{fmtInt(art.totalEstimated)}</td>
                              <td className="p-3 text-right text-slate-500">—</td>
                              <td className="p-3 text-right text-slate-500">—</td>
                              <td className={`p-3 text-right ${coverageColor(art.coverageDays, ozonSettings.minStockDays, ozonSettings.targetStockDays)}`}>
                                {fmtDays(art.coverageDays)}
                              </td>
                              <td className="p-3 text-right font-bold text-indigo-600">{fmtInt(art.recommendedQty)}</td>
                              <td className="p-3 text-right font-medium text-slate-800">{fmtInt(art.myStockAvailable)}</td>
                              <td className="p-3 text-right font-bold text-amber-600">{fmtInt(art.factory?.neededQty)}</td>
                            </tr>

                            {/* LEVEL 2: CLUSTERS ROWS */}
                            {isArtExpanded &&
                              art.clusters.map((cls: any) => {
                                const clusterKey = `${art.article}:::${cls.clusterId}`;
                                const isClsExpanded = !!expandedClusters[clusterKey];

                                return (
                                  <React.Fragment key={clusterKey}>
                                    <tr
                                      className="border-b border-slate-100 bg-slate-50/70 hover:bg-slate-100/60 cursor-pointer transition-colors"
                                      onClick={() => toggleCluster(clusterKey)}
                                      id={`ozon-cls-row-${cls.clusterId}`}
                                    >
                                      <td className="p-2.5 pl-8">
                                        <div className="flex items-center gap-1.5">
                                          {isClsExpanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                                          <span className="font-semibold text-slate-700">{cls.clusterName}</span>
                                        </div>
                                      </td>
                                      <td className="p-2.5 text-right text-slate-600">{fmtSpeed(cls.perDay)}</td>
                                      <td className="p-2.5 text-right font-semibold text-slate-800">{fmtInt(cls.available)}</td>
                                      <td className="p-2.5 text-right text-slate-600">{fmtInt(cls.transit)}</td>
                                      <td className="p-2.5 text-right text-slate-600">{fmtInt(cls.requested)}</td>
                                      <td className={`p-2.5 text-right ${coverageColor(cls.coverageDays, ozonSettings.minStockDays, ozonSettings.targetStockDays)}`}>
                                        {fmtDays(cls.coverageDays)}
                                      </td>
                                      <td className="p-2.5 text-right font-bold text-indigo-600">{fmtInt(cls.recommendedQty)}</td>
                                      <td className="p-2.5 text-right text-slate-400">—</td>
                                      <td className="p-2.5 text-right text-slate-400">—</td>
                                    </tr>

                                    {/* LEVEL 3: WAREHOUSES ROWS */}
                                    {isClsExpanded &&
                                      cls.warehouses.map((wh: any, idx: number) => (
                                        <tr
                                          key={`${clusterKey}-wh-${idx}`}
                                          className="border-b border-slate-100/50 bg-white hover:bg-slate-50 transition-colors text-slate-600"
                                          id={`ozon-wh-row-${cls.clusterId}-${idx}`}
                                        >
                                          <td className="p-2 pl-14 text-slate-500 font-normal">{wh.warehouseName}</td>
                                          <td className="p-2 text-right text-slate-300">—</td>
                                          <td className="p-2 text-right font-medium text-slate-700">{fmtInt(wh.available)}</td>
                                          <td className="p-2 text-right text-slate-500">{fmtInt(wh.transit)}</td>
                                          <td className="p-2 text-right text-slate-500">{fmtInt(wh.requested)}</td>
                                          <td className="p-2 text-right text-slate-300">—</td>
                                          <td className="p-2 text-right text-slate-300">—</td>
                                          <td className="p-2 text-right text-slate-300">—</td>
                                          <td className="p-2 text-right text-slate-300">—</td>
                                        </tr>
                                      ))}
                                  </React.Fragment>
                                );
                              })}
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
