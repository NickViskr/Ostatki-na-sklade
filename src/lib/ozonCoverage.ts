// ===== Модуль планирования поставок Ozon =====
// Часть 1: недели по МСК, сопоставление артикулов, скорость продаж.
// Все функции чистые: без обращения к стору, без побочных эффектов.

// Item 88, ticket 02: split by topic; this file keeps buildComponentCoverage/buildOzonCoverage and re-exports the rest.
import { KitItem, SKUItem } from '../types';
import {
  getMskWeekMonday,
  getLastFullWeeks,
  buildOfferIdToArticle,
  buildSalesSpeed,
  applyDeficitSpeedCorrection,
  buildRecentSpeed,
  applyDemandGrowth
} from './ozonSalesSpeed';
import type { SalesSpeedResult } from './ozonSalesSpeed';
import {
  parseExcludedClusters,
  parsePriorityClusters,
  buildClusterNameToId,
  buildClusterStocks,
  buildClusterShareWindow
} from './ozonClusters';
import type { ArticleStockAgg, OzonCoverageSettings } from './ozonClusters';
import { calcCoverageDays, calcSupplyRecommendation } from './ozonSupplyRecommendation';
import type { SupplyRecommendation } from './ozonSupplyRecommendation';
import { calcFactorySignal } from './ozonFactorySignal';
import type {
  ArticleCoverage,
  ClusterCoverageRow,
  ComponentCoverage,
  KitBottleneck,
  OzonCoverageInput,
  OzonCoverageResult
} from './ozonCoverageTypes';
import { buildStockHistoryContext, buildArticleSpeedByHistory, rebuildClusterSpeedByShareWithHistory } from './ozonStockHistory';
import { buildSalesTrendWithHistory } from './ozonSalesTrend';

export {
  NO_CLUSTER_NAME,
  getMskWeekMonday,
  getLastFullWeeks,
  resolveOzonArticle,
  buildOfferIdToArticle,
  resolveSalesArticle,
  buildSalesSpeed,
  MIN_WEEKS_WITH_SALES,
  applyDeficitSpeedCorrection,
  DEMAND_GROWTH_MIN_QTY,
  buildRecentSpeed,
  applyDemandGrowth
} from './ozonSalesSpeed';
export type { SalesSpeedResult, SpeedCorrectionInfo, DemandGrowthInfo, RecentSpeedResult } from './ozonSalesSpeed';

export {
  parseExcludedClusters,
  parsePriorityClusters,
  buildClusterNameToId,
  buildClusterStocks,
  buildClusterShareWindow,
  rebuildClusterSpeedByShare
} from './ozonClusters';
export type { OzonCoverageSettings, OzonClusterRef, ClusterStockAgg, ArticleStockAgg, ClusterShareWindow } from './ozonClusters';

export { calcCoverageDays, coverageTone, calcSupplyRecommendation } from './ozonSupplyRecommendation';
export type { CoverageTone, SupplyRecommendation } from './ozonSupplyRecommendation';

export { daysBetweenIso, factoryOnOrderByArticle, calcFactorySignal } from './ozonFactorySignal';
export type { FactoryOnOrderResult, FactorySignal } from './ozonFactorySignal';

export type {
  ClusterCoverageRow,
  ArticleCoverage,
  OzonPendingLike,
  ComponentCoverage,
  KitBottleneck,
  OzonCoverageInput,
  OzonCoverageResult
} from './ozonCoverageTypes';

export {
  HISTORY_MAX_LOOKBACK_WEEKS,
  MIN_HISTORY_DAYS,
  buildStockHistoryContext,
  isHistoryWeekCovered,
  historyArticleFraction,
  historyClusterFraction,
  historyWindowForArticle,
  buildArticleSpeedByHistory,
  rebuildClusterSpeedByShareWithHistory
} from './ozonStockHistory';
export type { StockHistoryContext, HistoryWindowResult, ArticleHistorySpeedInfo } from './ozonStockHistory';

export { MIN_SALES_FOR_TREND, buildSalesTrend, buildSalesTrendWithHistory } from './ozonSalesTrend';
export type { SalesTrend } from './ozonSalesTrend';

/**
 * Пункт 36. Покрытие по компонентам виртуальных комплектов и узкие места комплектов.
 * Скорость компонента = Σ по комплектам (скорость комплекта шт/д × норма расхода).
 * Запас (ТРУБА) = Σ по комплектам (расчётный остаток комплекта на Ozon × норма)
 * + собственный остаток компонента на Моём складе + заказанное на фабрике по компоненту.
 * Расчётный остаток комплекта — готовое поле totalEstimated агрегата остатков: так цифры
 * компонента и комплекта не расходятся между собой.
 * Комплекты legacy игнорируются полностью: у них есть собственный остаток, их поведение прежнее.
 * Заказы на фабрике, оформленные на КОМПЛЕКТ, в компоненты НЕ разворачиваются: такой заказ
 * означает заказ одного конкретного компонента, а не всего состава.
 * Заявки на поставку оформляются на КОМПЛЕКТ, а списываются с компонентов, поэтому резерв
 * комплекта разворачивается в резерв каждого его компонента по норме расхода.
 * Функция чистая: ничего не читает из стора и не изменяет входные объекты.
 */
export function buildComponentCoverage(
  kits: KitItem[],
  speed: SalesSpeedResult,
  // Item 85. What each kit can count on at Ozon — shelf AND on their way — by kit article.
  kitTotals: Record<string, { totalEstimated: number }>,
  skus: SKUItem[],
  myStockAvailability: Record<string, number>,
  factoryOnOrder: Record<string, number>,
  settings: OzonCoverageSettings,
  forecastPerDayByArticle?: Record<string, number>,
  // Зачёт по созданным заявкам, шт по артикулу КОМПЛЕКТА (поле byArticle из OzonPendingLike).
  // Тип — простой Record, а не импорт модуля заявок: обратная зависимость дала бы цикл модулей.
  pendingByArticle?: Record<string, number>,
  // 29.08.2026. Непокрытая потребность кластеров по артикулу КОМПЛЕКТА, шт комплектов.
  // Комплект на фабрике не заказывают, поэтому сигнал у него всегда null — и до этой правки
  // его дефицит не доходил вообще никуда: компонентам он передавался жёстким нулём. Владелец
  // видел «дефицит» у BowlGrayMini_01 и полное молчание по бутылкам, из-за которых дефицит
  // и возник.
  unmetByKit?: Record<string, number>
): { components: ComponentCoverage[]; bottlenecks: KitBottleneck[] } {
  const virtualKits = (kits || []).filter(k => k && k.type === 'virtual');
  if (!virtualKits.length) return { components: [], bottlenecks: [] };

  // Накопление по компоненту: скорость и запас складываются по всем комплектам, где компонент
  // участвует (случай «Бутылок» и «Пакетов» — они входят сразу в два комплекта).
  const acc = new Map<string, { perDay: number; forecastPerDay: number; fromKitsQty: number; reservedQty: number; usedInKits: string[] }>();

  for (const kit of virtualKits) {
    const kitSku = String(kit.kitSku || '').trim();
    if (!kitSku) continue;
    const kitPerDay = Number(speed.perDayByArticle[kitSku]) || 0;
    // Пункт 38: заказ на фабрике считается по компонентам, поэтому в него идёт ПРОГНОЗНАЯ
    // скорость комплекта; без неё тренд не работал бы на большей части оборота.
    const kitForecastPerDay = forecastPerDayByArticle && forecastPerDayByArticle[kitSku] !== undefined
      ? Number(forecastPerDayByArticle[kitSku]) || 0
      : kitPerDay;
    const kitStock = kitTotals[kitSku];
    const kitEstimated = kitStock ? Number(kitStock.totalEstimated) || 0 : 0;
    // Заявка на поставку пишется на артикул комплекта, но забирает со склада его компоненты.
    const kitPending = pendingByArticle ? Math.max(0, Number(pendingByArticle[kitSku]) || 0) : 0;

    for (const comp of kit.components || []) {
      const componentSku = String(comp.componentSku || '').trim();
      const norm = Number(comp.quantity) || 0;
      if (!componentSku || !(norm > 0)) continue;

      let row = acc.get(componentSku);
      if (!row) {
        row = { perDay: 0, forecastPerDay: 0, fromKitsQty: 0, reservedQty: 0, usedInKits: [] };
        acc.set(componentSku, row);
      }
      row.perDay += kitPerDay * norm;
      row.forecastPerDay += kitForecastPerDay * norm;
      row.fromKitsQty += kitEstimated * norm;
      row.reservedQty += kitPending * norm;
      if (!row.usedInKits.includes(kitSku)) row.usedInKits.push(kitSku);
    }
  }

  // Свободный остаток компонента — то, из чего прямо сейчас можно собирать: сырой остаток
  // минус обещанное созданным заявкам. Нужен до основного цикла, чтобы понять, КАКОЙ компонент
  // держит сборку комплекта.
  const freeByComponent: Record<string, number> = {};
  for (const [componentSku, accRow] of acc) {
    const my = Number(myStockAvailability[componentSku]) || 0;
    freeByComponent[componentSku] = Math.max(0, my - accRow.reservedQty);
  }

  // Дефицит комплекта переносится ТОЛЬКО на те компоненты, которые его держат, — на те, чей
  // свободный остаток и ограничивает сборку. Разносить дефицит по всем компонентам подряд
  // было бы неправдой: у BowlGrayMini_01 не хватает бутылок, а миски серые лежат на складе
  // тысячей штук, и подсвечивать их как дефицитные значило бы звать заказывать то, чего и так
  // в избытке.
  const unmetByComponent: Record<string, number> = {};
  for (const kit of virtualKits) {
    const kitSku = String(kit.kitSku || '').trim();
    if (!kitSku) continue;
    const kitUnmet = unmetByKit ? Math.max(0, Number(unmetByKit[kitSku]) || 0) : 0;
    if (!(kitUnmet > 0)) continue;

    const parts: { sku: string; norm: number; canGive: number }[] = [];
    let canAssemble = Number.POSITIVE_INFINITY;
    for (const comp of kit.components || []) {
      const componentSku = String(comp.componentSku || '').trim();
      const norm = Number(comp.quantity) || 0;
      if (!componentSku || !(norm > 0)) continue;
      const canGive = Math.floor((freeByComponent[componentSku] || 0) / norm);
      parts.push({ sku: componentSku, norm, canGive });
      if (canGive < canAssemble) canAssemble = canGive;
    }
    if (!parts.length) continue;
    if (!isFinite(canAssemble)) canAssemble = 0;

    for (const part of parts) {
      // Держит сборку тот, у кого свободного остатка ровно столько же, сколько у самого
      // узкого места. Ничья возможна — тогда дефицит получают оба.
      if (part.canGive > canAssemble) continue;
      unmetByComponent[part.sku] = (unmetByComponent[part.sku] || 0) + kitUnmet * part.norm;
    }
  }

  const components: ComponentCoverage[] = [];
  const byComponent: Record<string, ComponentCoverage> = {};
  for (const [componentSku, row] of acc) {
    // Карточки компонента в SKU Базе может не быть: тогда коробка 1, срок поставки 0 —
    // так же, как для обычного товара без карточки в buildOzonCoverage.
    const skuItem = skus.find(s => s.sku === componentSku);
    const pcsPerBox = skuItem && skuItem.pcsPerBox > 0 ? skuItem.pcsPerBox : 1;
    const leadTimeDays = skuItem ? (Number(skuItem.leadTimeDays) || 0) : 0;
    const myStockQty = Number(myStockAvailability[componentSku]) || 0;
    const reservedQty = row.reservedQty;
    // Свободно к сборке — только то, что ещё никому не обещано.
    const freeMyStockQty = Math.max(0, myStockQty - reservedQty);
    const onOrderQty = Math.max(0, Number(factoryOnOrder[componentSku]) || 0);
    // Сигнал считается той же функцией, что и по обычным товарам: роль «остатка Ozon» играет
    // запас, пришедший из расчётных остатков комплектов. Непокрытая потребность кластеров
    // приходит от комплектов, которые этот компонент держит.
    // Item 85, step 1.2: the free stock, not the raw one — see the pipeline comment below.
    const factory = calcFactorySignal(
      row.fromKitsQty,
      freeMyStockQty,
      row.forecastPerDay,
      leadTimeDays,
      pcsPerBox,
      settings,
      unmetByComponent[componentSku] || 0,
      onOrderQty
    );

    const coverage: ComponentCoverage = {
      component: componentSku,
      perDay: row.perDay,
      forecastPerDay: row.forecastPerDay,
      // Item 85, step 1.2. The reserve IS subtracted now. A reserved kit is counted in the kit's
      // total at Ozon as on its way (or in Ozon's columns once in acceptance), so its components
      // left «Мой склад» for the pipeline the moment the supply was created. Before item 85 the
      // kit total did not see supplies on the road and the raw figure was the lesser evil; a
      // written-off supply on the road then fell out of the pipeline altogether.
      pipelineQty: row.fromKitsQty + freeMyStockQty + onOrderQty,
      myStockQty,
      reservedQty,
      freeMyStockQty,
      onOrderQty,
      fromKitsQty: row.fromKitsQty,
      leadTimeDays,
      pcsPerBox,
      factory,
      usedInKits: row.usedInKits
    };
    components.push(coverage);
    byComponent[componentSku] = coverage;
  }

  const bottlenecks: KitBottleneck[] = [];
  for (const kit of virtualKits) {
    const kitSku = String(kit.kitSku || '').trim();
    if (!kitSku) continue;

    let worstSku = '';
    let worstDays: number | null = null;
    let canAssembleQty = Number.POSITIVE_INFINITY;

    for (const comp of kit.components || []) {
      const componentSku = String(comp.componentSku || '').trim();
      const norm = Number(comp.quantity) || 0;
      if (!componentSku || !(norm > 0)) continue;
      const row = byComponent[componentSku];
      if (!row) continue;

      // Покрытие компонента: запас ÷ скорость. Скорость 0 — покрытие «бесконечное» (null).
      const days = row.perDay > 0 ? row.pipelineQty / row.perDay : null;
      const current = days === null ? Number.POSITIVE_INFINITY : days;
      const worst = worstDays === null ? Number.POSITIVE_INFINITY : worstDays;
      if (!worstSku || current < worst) {
        worstSku = componentSku;
        worstDays = days;
      }
      // Собрать можно столько комплектов, на сколько хватает самого дефицитного компонента.
      // Здесь берётся СВОБОДНЫЙ остаток: товар, уже обещанный созданной заявкой, второй раз
      // собрать нельзя, иначе сборка выглядит возможной там, где брать уже нечего.
      canAssembleQty = Math.min(canAssembleQty, Math.floor(row.freeMyStockQty / norm));
    }

    if (!worstSku) continue;
    bottlenecks.push({
      kitSku,
      componentSku: worstSku,
      daysLeft: worstDays,
      canAssembleQty: isFinite(canAssembleQty) ? canAssembleQty : 0
    });
  }

  return { components, bottlenecks };
}

/**
 * Сборный расчёт покрытия и рекомендаций по всем товарам.
 * Товары — объединение артикулов из остатков Ozon и продаж за окно скорости.
 */
export function buildOzonCoverage(input: OzonCoverageInput): OzonCoverageResult {
  const now = input.now || new Date();
  const speedWeeks = input.settings.speedWeeks > 0 ? input.settings.speedWeeks : 4;
  const weeks = getLastFullWeeks(now, speedWeeks);
  // Пункт 39A. Карта строится ОДИН раз и передаётся во все три расчёта по продажам: получи
  // они разные карты, скорость, коррекция и тренд разошлись бы между собой по артикулам.
  const offerIdToArticle = buildOfferIdToArticle(input.stocks, input.skus);
  // Item 71. The current week enters the speed window by its elapsed days.
  const speed = buildSalesSpeed(input.sales, input.skus, weeks, offerIdToArticle, getMskWeekMonday(now));
  const stocksByArticle = buildClusterStocks(input.stocks, input.skus, input.settings.returnsToSalePct);

  // Item 86, step D. History-aware speed: absent/empty stockHistory makes every step below a
  // no-op (historyCtx has no covered weeks, historySpeedInfo stays empty), so nothing here
  // changes a single number when the sheet has not been collected yet.
  const historyCtx = buildStockHistoryContext(input.stockHistory || [], input.skus, offerIdToArticle);
  const historyCandidates = new Set<string>([
    ...Object.keys(stocksByArticle),
    ...Object.keys(speed.qtyByArticle),
    ...Object.keys(historyCtx.articleDaysByWeek)
  ]);
  const historySpeedInfo = buildArticleSpeedByHistory(
    input.sales, input.skus, input.settings, now, historyCtx, offerIdToArticle, [...historyCandidates]
  );
  for (const article of Object.keys(historySpeedInfo)) {
    speed.perDayByArticle[article] = historySpeedInfo[article].perDay;
  }
  // Item 86, step D, definition 3: the old empty-stock heuristic must not run where history
  // already covers the window — it already tells a real stock-out from slow demand.
  const historyCoveredArticles = new Set<string>(Object.keys(historySpeedInfo));

  const speedCorrections = applyDeficitSpeedCorrection(speed, input.stocks, input.sales, input.skus, input.settings, now, offerIdToArticle, historyCoveredArticles);
  // Item 73. The last 7 days against the window: above the threshold the larger speed wins.
  const demandGrowth = applyDemandGrowth(speed, buildRecentSpeed(input.sales, input.skus, now, offerIdToArticle), input.settings);
  // Item 86, step B. AFTER every article-level pass: split the (corrected) article speed between
  // its clusters by their share of sales over the longer share window, replacing item 72's
  // per-cluster deficit lift (two lifts of one empty cluster would have overstocked it).
  const trendWeeksForShare = Number(input.settings.trendWeeks) > 0 ? Math.floor(Number(input.settings.trendWeeks)) : 13;
  const shareWindow = buildClusterShareWindow(input.sales, input.skus, Math.max(trendWeeksForShare, speedWeeks), now, offerIdToArticle);
  const nameToId = buildClusterNameToId(input.clusters);
  // Item 86, step D, definition 4: a history-covered article gets the days-weighted share (or,
  // for a lookback article, a plain qty share over the lookback period) INSTEAD of step B's plain
  // qty share over the share window — everyone else keeps step B untouched.
  const clusterSharesPctByArticle = rebuildClusterSpeedByShareWithHistory(speed, shareWindow, historyCtx, historySpeedInfo, nameToId);
  // Пункт 38. Тренд считается ПОСЛЕ коррекции скорости: сработавшая коррекция гасит тренд.
  const trends = buildSalesTrendWithHistory(input.sales, input.skus, input.settings, now, speed, input.stocks, speedCorrections, historyCtx, historySpeedInfo, offerIdToArticle);
  // Прогнозная скорость = факт × тренд × (1 + прирост, %). Используется ТОЛЬКО в контуре заказа
  // на фабрике; рекомендации на поставку в кластеры Ozon считаются по фактической скорости.
  const salesGrowthK = 1 + (Number(input.settings.salesGrowthPct) || 0) / 100;
  const forecastPerDayByArticle: Record<string, number> = {};
  for (const article of Object.keys(speed.perDayByArticle)) {
    const trend = trends[article];
    // Item 85, step 1.4 (owner 2026-09-26: «брать большее из двух»). «Спрос вырос» (item 73) has
    // already replaced the article speed by the last 7 days, and the trend used to multiply THAT:
    // two lifts of one demand (Полка_выдв_27см: 3.96 → 5.18 → ×1.5 = 7.76/day, 642 pcs). The
    // factory now takes the larger of «window speed × trend» and «the 7-day speed», never their
    // product. Supplies to the clusters keep the 7-day speed as before.
    const growth = demandGrowth[article];
    const windowSpeed = growth && growth.applied ? growth.basePerDay : speed.perDayByArticle[article];
    const trended = windowSpeed * (trend ? trend.applied : 1);
    const recent = growth && growth.applied ? growth.recentPerDay : 0;
    forecastPerDayByArticle[article] = Math.max(trended, recent) * salesGrowthK;
  }
  const excludedIds = parseExcludedClusters(input.settings.excludedClusters);
  const priorityMap = parsePriorityClusters(input.settings.priorityClusters || '');

  // Item 86, step D: an article history flags (e.g. `noSales26`) must reach the screen even when
  // it has neither stock nor sales rows of its own left — historyCandidates is a superset of the
  // old union.
  const articleSet = new Set<string>([
    ...Object.keys(stocksByArticle),
    ...Object.keys(speed.qtyByArticle),
    ...historyCandidates
  ]);

  // Пункт 36: заказ на фабрике по виртуальному комплекту не считается — только по компонентам.
  const virtualKitSkus = new Set<string>(
    (input.kits || [])
      .filter(k => k && k.type === 'virtual')
      .map(k => String(k.kitSku || '').trim())
      .filter(Boolean)
  );

  // Item 85, step 1.6. A virtual kit is its components on the shelf; anything else is itself.
  const kitParts = new Map<string, { article: string; norm: number }[]>();
  for (const kit of input.kits || []) {
    if (!kit || kit.type !== 'virtual') continue;
    const kitSku = String(kit.kitSku || '').trim();
    const parts = (kit.components || [])
      .map((c) => ({ article: String(c.componentSku || '').trim(), norm: Number(c.quantity) || 0 }))
      .filter((c) => c.article && c.norm > 0);
    if (kitSku && parts.length) kitParts.set(kitSku, parts);
  }
  const partsOf = (article: string) => kitParts.get(article) || [{ article, norm: 1 }];
  const hasStock = (article: string) => Object.prototype.hasOwnProperty.call(input.myStockAvailability, article);
  const stockOf = (article: string) => Number(input.myStockAvailability[article]) || 0;
  // The reserve of created supplies per PHYSICAL article: a kit supply holds its components.
  const physReserve: Record<string, number> = {};
  const reserveByArticle = (input.pending && input.pending.byArticle) || {};
  for (const supplyArticle of Object.keys(reserveByArticle)) {
    const qty = Math.max(0, Number(reserveByArticle[supplyArticle]) || 0);
    for (const p of partsOf(supplyArticle)) physReserve[p.article] = (physReserve[p.article] || 0) + qty * p.norm;
  }
  /** Free on «Мой склад», counting every reserve on the same physical pieces. Without the stock
   *  of every component the old per-article figure stays (the caller's availability minus the
   *  article's own reserve). */
  const ownFreeOf = (article: string, fallback: number): number => {
    const parts = kitParts.get(article);
    if (!parts) return hasStock(article) ? Math.max(0, stockOf(article) - (physReserve[article] || 0)) : fallback;
    if (!parts.every((p) => hasStock(p.article))) return fallback;
    let units = Number.POSITIVE_INFINITY;
    for (const p of parts) units = Math.min(units, Math.floor((stockOf(p.article) - (physReserve[p.article] || 0)) / p.norm));
    return Math.max(0, isFinite(units) ? units : 0);
  };

  interface ArticleDraft {
    article: string;
    stockAgg: ArticleStockAgg;
    pcsPerBox: number;
    leadTimeDays: number;
    myStockAvailable: number;
    pendingTotal: number;
    freeMyStock: number;
    clusterRows: ClusterCoverageRow[];
    articleQtySold: number;
    unboundQtySold: number;
    unboundEstimated: number;
    totalEstimated: number;
  }
  const drafts: ArticleDraft[] = [];

  for (const article of articleSet) {
    const stockAgg: ArticleStockAgg = stocksByArticle[article] || { article, totalShelf: 0, unboundShelf: 0, unboundOzonInFlight: 0, byCluster: {} };
    const skuItem = input.skus.find(s => s.sku === article);
    const pcsPerBox = skuItem && skuItem.pcsPerBox > 0 ? skuItem.pcsPerBox : 1;
    const leadTimeDays = skuItem ? (Number(skuItem.leadTimeDays) || 0) : 0;
    const myStockAvailable = Number(input.myStockAvailability[article]) || 0;
    // Локальный зачёт: товар из созданных заявок физически ещё лежит на Моём складе
    // (расход проводится только при ACCEPTED_AT_SUPPLY_WAREHOUSE), поэтому он резервируется
    // и не может быть повторно распределён в другой кластер.
    const pendingByCluster = (input.pending && input.pending.byArticleCluster[article]) || {};
    const pendingTotal = Math.max(0, Number(input.pending && input.pending.byArticle[article]) || 0);
    const freeMyStock = ownFreeOf(article, Math.max(0, myStockAvailable - pendingTotal));

    const qtyByClusterId: Record<string, number> = {};
    const perDayByClusterId: Record<string, number> = {};
    const clusterNamesById: Record<string, string> = {};
    let unboundQtySold = 0;

    const articleClusterQty = speed.qtyByArticleCluster[article] || {};
    const articleClusterPerDay = speed.perDayByArticleCluster[article] || {};
    // Item 86, step B. A cluster that sold in the long share window may have no sales in the
    // speed window at all: it still has a speed (article speed × its share).
    const clusterNames = new Set<string>([...Object.keys(articleClusterQty), ...Object.keys(articleClusterPerDay)]);
    for (const clusterName of clusterNames) {
      const qty = articleClusterQty[clusterName] || 0;
      const id = nameToId[clusterName] || '';
      if (!id) {
        unboundQtySold += qty;
        continue;
      }
      qtyByClusterId[id] = (qtyByClusterId[id] || 0) + qty;
      perDayByClusterId[id] = (perDayByClusterId[id] || 0) + (articleClusterPerDay[clusterName] || 0);
      clusterNamesById[id] = clusterName;
    }

    const articleQtySold = speed.qtyByArticle[article] || 0;

    // Пункт 66. Список кластеров товара — это остатки ПЛЮС продажи ПЛЮС кластеры, куда
    // товар уже едет по созданной заявке. Без третьего слагаемого кластер, в который
    // только что оформили поставку, пропадал из таблицы до самой приёмки: остатка там
    // ещё нет и продаж нет, а товар в пути. Рекомендаций это не добавляет — скорость
    // в таком кластере нулевая, и расчёт всё равно возвращает null.
    const clusterIds = new Set<string>([
      ...Object.keys(stockAgg.byCluster),
      ...Object.keys(qtyByClusterId),
      ...Object.keys(pendingByCluster).filter((id) => (Number(pendingByCluster[id]) || 0) > 0)
    ]);

    // Item 85, step 1.1. Pieces on their way without a cluster count once, like a cluster's.
    const unboundOurInFlight = Math.max(0, Number(input.pending && input.pending.unboundInFlightByArticle && input.pending.unboundInFlightByArticle[article]) || 0);
    const unboundEstimated = stockAgg.unboundShelf + Math.max(unboundOurInFlight, stockAgg.unboundOzonInFlight);
    let totalEstimated = unboundEstimated;

    const clusterRows: ClusterCoverageRow[] = [];
    for (const clusterId of clusterIds) {
      const st = stockAgg.byCluster[clusterId];
      const perDay = perDayByClusterId[clusterId] || 0;
      const qtySold = qtyByClusterId[clusterId] || 0;
      const isExcluded = excludedIds.has(clusterId);
      // Item 85, step 1.1. On their way = the LARGER of our own supplies (fresh: statuses come
      // with every poll) and Ozon's «В пути» + «В заявках» (its stock analytics lags up to half a
      // day). Both describe the same supplies, so never their sum. The old rule compared our
      // supplies before the HUB with «В заявках» alone: a supply already past the hub still sat
      // in «В заявках», and a new request replaced it instead of adding to it — the cluster was
      // recommended again right after the owner created a supply.
      const pendingQty = Math.max(0, Number(pendingByCluster[clusterId]) || 0);
      const ozonInFlightQty = st ? st.ozonInFlight : 0;
      const inFlightQty = Math.max(pendingQty, ozonInFlightQty);
      const estimated = (st ? st.shelf : 0) + inFlightQty;
      totalEstimated += estimated;
      const priorityK = isExcluded ? 1 : (priorityMap[clusterId] || 1);
      const isPriority = priorityK > 1;
      const effectiveSettings = isPriority
        ? {
            ...input.settings,
            minStockDays: input.settings.minStockDays * priorityK,
            targetStockDays: input.settings.targetStockDays * priorityK,
          }
        : input.settings;
      const requestedQty = st ? Math.max(0, Number(st.requested) || 0) : 0;
      // Item 85, step 1.8 (owner 2026-09-26): coverage is ONE number and it includes the goods
      // on their way — a cluster with 24 pieces coming must not read «−12 дней» in red.
      const coverage = calcCoverageDays(estimated, perDay, effectiveSettings.minStockDays, isExcluded);
      const recommendation = isExcluded
        ? null
        : calcSupplyRecommendation(perDay, estimated, effectiveSettings, pcsPerBox, Number.MAX_SAFE_INTEGER);

      clusterRows.push({
        clusterId,
        clusterName: (st && st.clusterName) || clusterNamesById[clusterId] || clusterId,
        qtySold,
        perDay,
        available: st ? st.available : 0,
        transit: st ? st.transit : 0,
        returns: st ? st.returns : 0,
        estimated,
        coverageDays: coverage,
        excluded: isExcluded,
        priority: isPriority,
        priorityK,
        unmetQty: 0,
        pendingQty,
        requestedQty,
        ozonInFlightQty,
        inFlightQty,
        recommendation,
        speedSharePct: (clusterSharesPctByArticle[article] && clusterSharesPctByArticle[article][clusterNamesById[clusterId] || '']) || 0,
        shareWindowWeeks: shareWindow.windowWeeksLabel
      });
    }
    clusterRows.sort((a, b) => b.qtySold - a.qtySold);

    drafts.push({
      article, stockAgg, pcsPerBox, leadTimeDays, myStockAvailable, pendingTotal, freeMyStock,
      clusterRows, articleQtySold, unboundQtySold, unboundEstimated, totalEstimated
    });
  }

  // ===== Item 85, step 1.6: a component shared by several kits is split between them =====
  // Each kit used to see ALL the bottles as its own, so two kits could be recommended more
  // bottles together than lie on the shelf. When the kits' combined need of a shared component
  // exceeds what is free of it, the component is split in proportion to each kit's need, the
  // kits limited elsewhere (their own bowls) are given only what they can use, and the rest
  // goes to the others — repeated until nothing moves. A component sold on Ozon by itself takes
  // part as one more claimant with norm 1.
  const wantByArticle: Record<string, number> = {};
  for (const d of drafts) {
    wantByArticle[d.article] = d.clusterRows.reduce((sum, r) => sum + (r.recommendation ? r.recommendation.wantQty : 0), 0);
  }
  const claimants = new Map<string, { article: string; norm: number }[]>();
  for (const d of drafts) {
    for (const p of partsOf(d.article)) {
      const list = claimants.get(p.article) || [];
      list.push({ article: d.article, norm: p.norm });
      claimants.set(p.article, list);
    }
  }
  const freeByDraft: Record<string, number> = {};
  for (const d of drafts) freeByDraft[d.article] = d.freeMyStock;
  // alloc[article][component] — units of the ARTICLE the component allows; absent = no limit.
  const alloc: Record<string, Record<string, number>> = {};
  const sharedComponents = Array.from(claimants.keys())
    .filter((c) => (claimants.get(c) || []).length > 1 && hasStock(c))
    .sort();
  const capExcept = (article: string, skip: string) => {
    let cap = freeByDraft[article];
    const own = alloc[article] || {};
    for (const c of Object.keys(own)) if (c !== skip) cap = Math.min(cap, own[c]);
    return cap;
  };
  for (let round = 0; round < 20; round++) {
    let changed = false;
    for (const c of sharedComponents) {
      const list = claimants.get(c) || [];
      const budget = Math.max(0, stockOf(c) - (physReserve[c] || 0));
      const demand = list.map((x) => ({ ...x, units: Math.max(0, Math.min(wantByArticle[x.article] || 0, capExcept(x.article, c))) }));
      const total = demand.reduce((sum, x) => sum + x.units * x.norm, 0);
      const next: Record<string, number> = {};
      if (total <= budget) {
        for (const x of demand) next[x.article] = Number.POSITIVE_INFINITY;
      } else {
        let left = budget;
        for (const x of demand) {
          next[x.article] = Math.floor((budget * (x.units * x.norm) / total) / x.norm);
          left -= next[x.article] * x.norm;
        }
        // Pieces left by the rounding go one unit at a time to the largest unmet need.
        let moved = true;
        while (moved) {
          moved = false;
          const order = demand
            .filter((x) => next[x.article] < x.units && x.norm <= left)
            .sort((a, b) => ((b.units - next[b.article]) - (a.units - next[a.article])) || a.article.localeCompare(b.article));
          if (order.length) {
            next[order[0].article] += 1;
            left -= order[0].norm;
            moved = true;
          }
        }
      }
      for (const x of demand) {
        const prev = alloc[x.article] && alloc[x.article][c];
        if (prev !== next[x.article]) {
          if (!alloc[x.article]) alloc[x.article] = {};
          alloc[x.article][c] = next[x.article];
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const articles: ArticleCoverage[] = [];
  for (const d of drafts) {
    const { article, stockAgg, pcsPerBox, leadTimeDays, myStockAvailable, pendingTotal, freeMyStock, clusterRows,
      articleQtySold, unboundQtySold, unboundEstimated, totalEstimated } = d;
    const shippableMyStock = capExcept(article, '');
    const sharedLimitedBy = Object.keys(alloc[article] || {}).filter((c) => alloc[article][c] < freeMyStock).sort();

    // Распределение остатка Моего склада между кластерами: остаток один на всех, поэтому
    // рекомендации выдаются по очереди — сначала приоритетные (по убыванию коэффициента),
    // затем остальные по возрастанию покрытия. Кому не хватило — урезанная рекомендация.
    // Item 51: the hand-out goes IN PIECES, not in whole boxes, and the amount comes from
    // wantQty — the single place where «how much this cluster needs» is decided, partial box
    // of a slow cluster included. Before, boxesNeeded was recomputed from neededQty here, so
    // the box rounding lived in two places at once and would have drifted apart.
    const boxSize = pcsPerBox > 0 ? pcsPerBox : 1;
    let remainingStock = shippableMyStock;
    const distributionOrder = clusterRows
      .filter(r => r.recommendation !== null)
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority ? -1 : 1;
        if (a.priority && b.priority && a.priorityK !== b.priorityK) return b.priorityK - a.priorityK;
        const ca = a.coverageDays === null ? Number.POSITIVE_INFINITY : a.coverageDays;
        const cb = b.coverageDays === null ? Number.POSITIVE_INFINITY : b.coverageDays;
        return ca - cb;
      });
    for (const row of distributionOrder) {
      const rec = row.recommendation as SupplyRecommendation;
      const giveQty = Math.min(rec.wantQty, Math.floor(Math.max(0, remainingStock)));
      remainingStock -= giveQty;
      row.unmetQty = rec.wantQty - giveQty;
      row.recommendation = {
        ...rec,
        boxes: Math.ceil(giveQty / boxSize),
        qty: giveQty,
        limitedByMyStock: giveQty < rec.wantQty
      };
    }

    const perDay = speed.perDayByArticle[article] || 0;
    const unmetDeficitQty = clusterRows.reduce((s, r) => s + (r.unmetQty || 0), 0);
    const onOrderQty = Math.max(0, Number(input.factoryOnOrder && input.factoryOnOrder[article]) || 0);
    const forecastPerDay = forecastPerDayByArticle[article] || 0;
    // Item 85, step 1.2. The pipeline takes «Мой склад» NET of the reserve: a reserved piece is
    // already counted above as on its way to a cluster (or, once in acceptance, in Ozon's own
    // columns), so the raw figure would count it twice. The old raw figure was right only while
    // written-off pieces on the road were counted nowhere — they are now.
    const factory = virtualKitSkus.has(article)
      ? null
      : calcFactorySignal(
          totalEstimated,
          freeMyStock,
          forecastPerDay,
          leadTimeDays,
          pcsPerBox,
          input.settings,
          unmetDeficitQty,
          onOrderQty
        );

    const historyInfo = historySpeedInfo[article];
    articles.push({
      article,
      qtySold: articleQtySold,
      perDay,
      forecastPerDay,
      trend: trends[article] || null,
      pcsPerBox,
      leadTimeDays,
      myStockAvailable,
      totalEstimated,
      unboundEstimated,
      unboundQtySold,
      unmetDeficitQty,
      pendingTotal,
      freeMyStock,
      shippableMyStock,
      sharedLimitedBy,
      clusters: clusterRows,
      factory,
      speedCorrection: speedCorrections[article] || null,
      demandGrowth: demandGrowth[article] || null,
      speedSource: historyInfo ? historyInfo.source : 'calendar',
      speedDaysInStock: historyInfo ? historyInfo.daysInStock : 0,
      speedSoldQty: historyInfo ? Object.values(historyInfo.qtyByCluster).reduce((s, q) => s + q, 0) : 0,
      speedWindowDays: historyInfo ? historyInfo.windowDays : speed.windowDays,
      speedPeriod: historyInfo ? historyInfo.period : undefined,
      speedApproximate: historyInfo ? historyInfo.approximate : false,
      noSales26: historyInfo ? historyInfo.noSales26 : false
    });
  }

  articles.sort((a, b) => b.perDay - a.perDay);

  // Дефицит кластеров у виртуального комплекта посчитан выше вместе со всеми товарами, но
  // самому комплекту он бесполезен: на фабрике заказывают не его, а компоненты. Собираем его
  // здесь и передаём вниз.
  const unmetByKit: Record<string, number> = {};
  for (const row of articles) {
    if (!virtualKitSkus.has(row.article)) continue;
    if (row.unmetDeficitQty > 0) unmetByKit[row.article] = row.unmetDeficitQty;
  }

  const kitTotals: Record<string, { totalEstimated: number }> = {};
  for (const row of articles) kitTotals[row.article] = row;
  const { components, bottlenecks } = buildComponentCoverage(
    input.kits || [],
    speed,
    kitTotals,
    input.skus,
    input.myStockAvailability,
    input.factoryOnOrder || {},
    input.settings,
    forecastPerDayByArticle,
    input.pending?.byArticle,
    unmetByKit
  );

  return { speed, articles, components, bottlenecks, trends };
}

