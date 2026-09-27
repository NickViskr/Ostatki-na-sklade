// Item 88, ticket 04: the React seam over `ozonStocksTabModel.ts`. Calls the SAME stage
// functions the model exports, each in its own `useMemo` with the same dependency granularity
// as the memo it replaces in the screen — a search keystroke must not recompute coverage, and a
// tick must only recompute the supply plan and the cabinet sets. The `OZONPERF` console lines
// move here verbatim: same text, same trigger.
import { useMemo } from 'react';
import { FactoryOrder, OzonSalesRow, OzonStockRow, SKUItem } from '../types';
import { OzonCoverageResult, OzonCoverageSettings } from '../lib/ozonCoverage';
import { CoverageSource, computeCoverage } from '../lib/ozonCoverageSource';
import {
  buildActiveFactoryOrders,
  buildBottleneckByKit,
  buildCabinetsByArticleMap,
  buildClusterShares,
  buildComponentRows,
  buildCoverageRows,
  buildFactoryCellByArticle,
  buildFactoryCellByComponent,
  buildFactoryOrdersByArticle,
  buildHiddenManualByArticle,
  buildHiddenManualIds,
  buildManualCabinetSets,
  buildManualClusterIds,
  buildManualInfos,
  buildManualPicks,
  buildManualPlanStage,
  buildRecommendations,
  buildSelectedCabinetSets,
  buildSupplyClusterRefs,
  buildSupplyPlan,
  buildSupplyStockOptions,
  buildVisibleRows,
  findFactoryModalRow,
  OzonStocksTabModel,
  resolveWideWeeks,
} from '../lib/ozonStocksTabModel';

export interface UseOzonStocksTabModelParams {
  coverageSource: CoverageSource;
  ozonSettings: OzonCoverageSettings;
  runCoverage: (settings: OzonCoverageSettings) => OzonCoverageResult | null;
  skus: SKUItem[];
  clusterRefs: { clusterId: string; clusterName: string }[];
  factoryOrders: FactoryOrder[] | null | undefined;
  wideArticles: Record<string, boolean>;
  selectedSupply: Record<string, boolean>;
  manualQty: Record<string, string>;
  searchQuery: string;
  onlyWithRecommendations: boolean;
  factoryModalArticle: string | null;
  maxBoxesPerCluster: number;
  /** The screen's own mount-time today, used by `splitFactoryOrders` — never read from the clock. */
  todayIso: string;
}

export function useOzonStocksTabModel(params: UseOzonStocksTabModelParams): OzonStocksTabModel {
  const {
    coverageSource, ozonSettings, runCoverage, skus, clusterRefs, factoryOrders,
    wideArticles, selectedSupply, manualQty, searchQuery, onlyWithRecommendations,
    factoryModalArticle, maxBoxesPerCluster, todayIso,
  } = params;

  const filteredOzonStocks: OzonStockRow[] = coverageSource.stocks;
  const filteredOzonSales: OzonSalesRow[] = coverageSource.sales;
  const pendingSupplies = coverageSource.pending;
  const openFactoryOrders = coverageSource.openFactoryOrders;
  const factoryOnOrder = openFactoryOrders.qty;

  const coverage = useMemo<OzonCoverageResult | null>(() => {
    // Пункт 29, этап E: замер времени расчёта. Диагностика, логику не меняет.
    const perfStart = performance.now();
    const result = runCoverage(ozonSettings);
    console.log(`OZONPERF coverage total=${Math.round(performance.now() - perfStart)}ms stocks=${filteredOzonStocks.length} sales=${filteredOzonSales.length} skus=${skus.length} clusters=${clusterRefs.length}`);
    return result;
  }, [runCoverage, ozonSettings, filteredOzonStocks, filteredOzonSales, skus, clusterRefs]);

  const anyWide = Object.keys(wideArticles).some((a) => wideArticles[a]);
  /** Окно тренда из настроек: сколько недель берём, когда распределяем весь остаток. */
  const wideWeeks = resolveWideWeeks(ozonSettings);

  /**
   * Тот же расчёт покрытия, но скорость продаж считается за окно тренда. Считается только
   * тогда, когда хотя бы один товар переключён кнопкой: расчёт тяжёлый, а нужен он редко.
   * Из результата берутся ТОЛЬКО кластеры переключённых товаров — всё остальное на экране
   * по-прежнему живёт по обычному окну скорости.
   */
  const wideCoverage = useMemo<OzonCoverageResult | null>(() => {
    if (!anyWide) return null;
    if (!coverageSource.ready) return null;
    const perfStart = performance.now();
    const result = computeCoverage(coverageSource, { ...ozonSettings, speedWeeks: wideWeeks });
    console.log(`OZONPERF wideCoverage total=${Math.round(performance.now() - perfStart)}ms weeks=${wideWeeks}`);
    return result;
  }, [anyWide, wideWeeks, coverageSource, ozonSettings]);

  const coverageRows = useMemo(() => {
    // Пункт 29, этап E: замер времени. Диагностика, логику не меняет.
    const rowsPerfStart = performance.now();
    const rows = buildCoverageRows(
      coverage, filteredOzonStocks, filteredOzonSales, skus,
      ozonSettings.minStockDays, ozonSettings.deliveryToOzonDays || 0, factoryOnOrder, pendingSupplies
    );
    console.log(`OZONPERF coverageRows total=${Math.round(performance.now() - rowsPerfStart)}ms rows=${rows.length}`);
    return rows;
  }, [coverage, filteredOzonStocks, filteredOzonSales, skus, ozonSettings.minStockDays, ozonSettings.deliveryToOzonDays, factoryOnOrder, pendingSupplies]);

  // Пункт 36. Компоненты виртуальных комплектов: на фабрике заказывают их, а не комплект.
  const componentRows = useMemo(() => buildComponentRows(coverage), [coverage]);

  // Пункт 36. Узкое место по артикулу комплекта.
  const bottleneckByKit = useMemo(() => buildBottleneckByKit(coverage), [coverage]);

  const visibleRows = useMemo(
    () => buildVisibleRows(coverageRows, searchQuery, onlyWithRecommendations),
    [coverageRows, searchQuery, onlyWithRecommendations]
  );

  const clusterShares = useMemo(() => buildClusterShares(coverageRows), [coverageRows]);

  // Пункт 35. Все активные заказы по артикулу, отсортированы по дате ожидания.
  const factoryOrdersByArticle = useMemo(() => buildFactoryOrdersByArticle(factoryOrders), [factoryOrders]);

  // Item 85, step 1.7: the ids of manual orders the pipeline hides — kept out of «уже заказано».
  const hiddenManualIds = useMemo(() => buildHiddenManualIds(openFactoryOrders), [openFactoryOrders]);

  // Item 83e: manual orders hidden from the ТРУБА by an active China row of the same article.
  const hiddenManualByArticle = useMemo(() => buildHiddenManualByArticle(openFactoryOrders), [openFactoryOrders]);

  // Item 88 ticket 04 follow-up: the article-level and component-level «Фабрика» cell state,
  // by article/component, so the screen reads it instead of computing it per row during render.
  const factoryCellByArticle = useMemo(
    () => buildFactoryCellByArticle(coverageRows, factoryOrdersByArticle, todayIso, hiddenManualIds, hiddenManualByArticle, bottleneckByKit),
    [coverageRows, factoryOrdersByArticle, todayIso, hiddenManualIds, hiddenManualByArticle, bottleneckByKit]
  );
  const factoryCellByComponent = useMemo(
    () => buildFactoryCellByComponent(componentRows, factoryOrdersByArticle, todayIso, hiddenManualIds),
    [componentRows, factoryOrdersByArticle, todayIso, hiddenManualIds]
  );

  // Item 83f/83g: MANUAL row only — the modal's «new order» form edits a manual order, never a
  // China row (those are read-only, «управляется во вкладке «Заказы в Китае»»).
  const activeFactoryOrders = useMemo(() => buildActiveFactoryOrders(factoryOrders), [factoryOrders]);

  const factoryModalRow = useMemo(
    () => findFactoryModalRow(coverageRows, componentRows, factoryModalArticle),
    [coverageRows, componentRows, factoryModalArticle]
  );

  // Пункт 59. Заявка принадлежит ОДНОМУ магазину.
  const cabinetsByArticleMap = useMemo(() => buildCabinetsByArticleMap(coverageRows), [coverageRows]);

  const selectedCabinetSets = useMemo(
    () => buildSelectedCabinetSets(selectedSupply, cabinetsByArticleMap),
    [selectedSupply, cabinetsByArticleMap]
  );

  const supplyStockOptions = useMemo(() => buildSupplyStockOptions(coverageRows), [coverageRows]);

  // Пункт 63/64. Куда вообще можно везти: справочник кластеров минус исключённые настройкой.
  const supplyClusterRefs = useMemo(
    () => buildSupplyClusterRefs(ozonSettings ? ozonSettings.excludedClusters : '', clusterRefs),
    [clusterRefs, ozonSettings]
  );

  const manualPicks = useMemo(() => buildManualPicks(manualQty), [manualQty]);
  const manualClusterIds = useMemo(() => buildManualClusterIds(manualPicks), [manualPicks]);
  const manualCabinetSets = useMemo(
    () => buildManualCabinetSets(manualPicks, cabinetsByArticleMap),
    [manualPicks, cabinetsByArticleMap]
  );
  const manualInfos = useMemo(
    () => buildManualInfos(coverageRows, supplyClusterRefs, clusterShares.byClusterId),
    [coverageRows, supplyClusterRefs, clusterShares]
  );
  const manualPlan = useMemo(() => buildManualPlanStage(manualPicks, manualInfos), [manualPicks, manualInfos]);

  const recommendations = useMemo(
    () => buildRecommendations(coverageRows, wideArticles, wideCoverage, factoryOnOrder),
    [coverageRows, activeFactoryOrders, factoryOnOrder, wideArticles, wideCoverage]
  );

  const supplyPlan = useMemo(
    () => buildSupplyPlan(recommendations, coverageRows, selectedSupply, maxBoxesPerCluster),
    [recommendations, coverageRows, selectedSupply, maxBoxesPerCluster]
  );

  return {
    coverage,
    wideCoverage,
    coverageRows,
    componentRows,
    bottleneckByKit,
    visibleRows,
    clusterShares,
    factoryOrdersByArticle,
    activeFactoryOrders,
    hiddenManualIds,
    hiddenManualByArticle,
    factoryCellByArticle,
    factoryCellByComponent,
    factoryModalRow,
    cabinetsByArticleMap,
    selectedCabinetSets,
    supplyStockOptions,
    supplyClusterRefs,
    manualPicks,
    manualClusterIds,
    manualCabinetSets,
    manualInfos,
    manualPlan,
    recommendations,
    supplyPlan,
  };
}
