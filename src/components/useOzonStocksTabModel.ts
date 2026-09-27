// Item 88, ticket 04: the React seam over `ozonStocksTabModel.ts`. Takes exactly the model's own
// input type and calls the SAME stage functions the model exports, each in its own `useMemo`
// with the same dependency granularity as the memo it replaces in the screen — a search
// keystroke must not recompute coverage, and a tick must only recompute the supply plan and the
// cabinet sets. The `OZONPERF` console lines move here verbatim: same text, same trigger.
//
// Taking `OzonStocksTabModelInput` (not a hand-picked subset) is deliberate: it is the same
// input `buildOzonStocksTabModel` takes, so a parity test can call both with the SAME object and
// prove the hook computes what the pure model computes — the earlier version took the screen's
// own `runCoverage`/`skus`/`clusterRefs` instead of `input.source`, so parity could not be shown.
import { useMemo } from 'react';
import { pickedCabinetSets, pickedClusterIds, readManualPicks, buildManualPlan } from '../lib/ozonManualSupply';
import { OzonCoverageResult } from '../lib/ozonCoverage';
import { computeCoverage } from '../lib/ozonCoverageSource';
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
  buildManualInfos,
  buildOffOzonFactoryOrders,
  buildRecommendations,
  buildSelectedCabinetSets,
  buildSelectedClusterIds,
  buildSupplyClusterRefs,
  buildSupplyPlan,
  buildSupplyStockOptions,
  buildVisibleRows,
  findFactoryModalRow,
  OzonStocksTabModel,
  OzonStocksTabModelInput,
  resolveWideWeeks,
} from '../lib/ozonStocksTabModel';

export function useOzonStocksTabModel(input: OzonStocksTabModelInput): OzonStocksTabModel {
  const { source, settings, factoryOrders, wideArticles, selectedSupply, manualQty, searchQuery, onlyWithRecommendations, factoryModalArticle, maxBoxesPerCluster, todayIso } = input;

  const factoryOnOrder = source.openFactoryOrders.qty;

  const coverage = useMemo<OzonCoverageResult | null>(() => {
    // Пункт 29, этап E: замер времени расчёта. Диагностика, логику не меняет.
    const perfStart = performance.now();
    const result = computeCoverage(source, settings);
    console.log(`OZONPERF coverage total=${Math.round(performance.now() - perfStart)}ms stocks=${source.stocks.length} sales=${source.sales.length} skus=${source.skus.length} clusters=${source.clusters.length}`);
    return result;
  }, [source, settings]);

  const anyWide = Object.keys(wideArticles).some((a) => wideArticles[a]);
  /** Окно тренда из настроек: сколько недель берём, когда распределяем весь остаток. */
  const wideWeeks = resolveWideWeeks(settings);

  /**
   * Тот же расчёт покрытия, но скорость продаж считается за окно тренда. Считается только
   * тогда, когда хотя бы один товар переключён кнопкой: расчёт тяжёлый, а нужен он редко.
   * Из результата берутся ТОЛЬКО кластеры переключённых товаров — всё остальное на экране
   * по-прежнему живёт по обычному окну скорости.
   */
  const wideCoverage = useMemo<OzonCoverageResult | null>(() => {
    if (!anyWide) return null;
    if (!source.ready) return null;
    const perfStart = performance.now();
    const result = computeCoverage(source, { ...settings, speedWeeks: wideWeeks });
    console.log(`OZONPERF wideCoverage total=${Math.round(performance.now() - perfStart)}ms weeks=${wideWeeks}`);
    return result;
  }, [anyWide, wideWeeks, source, settings]);

  const coverageRows = useMemo(() => {
    // Пункт 29, этап E: начало отсчёта времени. Диагностика.
    const rowsPerfStart = performance.now();
    const rows = buildCoverageRows(
      coverage, source.stocks, source.sales, source.skus,
      settings.minStockDays, settings.deliveryToOzonDays || 0, factoryOnOrder, source.pending
    );
    console.log(`OZONPERF coverageRows total=${Math.round(performance.now() - rowsPerfStart)}ms rows=${rows.length}`);
    return rows;
  }, [coverage, source, settings.minStockDays, settings.deliveryToOzonDays, factoryOnOrder]);

  // Пункт 36. Компоненты виртуальных комплектов: на фабрике заказывают их, а не комплект.
  const componentRows = useMemo(
    () => buildComponentRows(coverage, settings.minStockDays, settings.deliveryToOzonDays || 0),
    [coverage, settings.minStockDays, settings.deliveryToOzonDays]
  );

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
  const hiddenManualIds = useMemo(() => buildHiddenManualIds(source.openFactoryOrders), [source.openFactoryOrders]);

  // Item 83e: manual orders hidden from the ТРУБА by an active China row of the same article.
  const hiddenManualByArticle = useMemo(() => buildHiddenManualByArticle(source.openFactoryOrders), [source.openFactoryOrders]);

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

  const offOzonFactoryOrders = useMemo(
    () => buildOffOzonFactoryOrders(coverageRows, componentRows, factoryOrdersByArticle),
    [coverageRows, componentRows, factoryOrdersByArticle]
  );

  // Пункт 59. Заявка принадлежит ОДНОМУ магазину.
  const cabinetsByArticleMap = useMemo(() => buildCabinetsByArticleMap(coverageRows), [coverageRows]);

  const selectedCabinetSets = useMemo(
    () => buildSelectedCabinetSets(selectedSupply, cabinetsByArticleMap),
    [selectedSupply, cabinetsByArticleMap]
  );

  const selectedClusterIds = useMemo(() => buildSelectedClusterIds(selectedSupply), [selectedSupply]);

  const supplyStockOptions = useMemo(() => buildSupplyStockOptions(coverageRows), [coverageRows]);

  // Пункт 63/64. Куда вообще можно везти: справочник кластеров минус исключённые настройкой.
  const supplyClusterRefs = useMemo(
    () => buildSupplyClusterRefs(settings ? settings.excludedClusters : '', source.clusters),
    [source.clusters, settings]
  );

  const manualPicks = useMemo(() => readManualPicks(manualQty), [manualQty]);
  const manualClusterIds = useMemo(() => pickedClusterIds(manualPicks), [manualPicks]);
  const manualCabinetSets = useMemo(
    () => pickedCabinetSets(manualPicks, cabinetsByArticleMap),
    [manualPicks, cabinetsByArticleMap]
  );
  const manualInfos = useMemo(
    () => buildManualInfos(coverageRows, supplyClusterRefs, clusterShares.byClusterId),
    [coverageRows, supplyClusterRefs, clusterShares]
  );
  const manualPlan = useMemo(() => buildManualPlan(manualPicks, manualInfos), [manualPicks, manualInfos]);

  const recommendations = useMemo(
    () => buildRecommendations(coverageRows, wideArticles, wideCoverage, factoryOnOrder),
    [coverageRows, factoryOnOrder, wideArticles, wideCoverage]
  );

  const supplyPlan = useMemo(
    () => buildSupplyPlan(recommendations, coverageRows, selectedSupply, maxBoxesPerCluster),
    [recommendations, coverageRows, selectedSupply, maxBoxesPerCluster]
  );

  return {
    coverage,
    wideCoverage,
    anyWide,
    wideWeeks,
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
    offOzonFactoryOrders,
    cabinetsByArticleMap,
    selectedCabinetSets,
    selectedClusterIds,
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
