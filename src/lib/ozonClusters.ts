// Item 88, ticket 02. Cluster stock aggregation, settings, and the long-window cluster share.
import { OzonSalesRow, OzonStockRow, SKUItem } from '../types';
import { NO_CLUSTER_NAME, getLastFullWeeks, getMskWeekMonday, resolveOzonArticle, resolveSalesArticle } from './ozonSalesSpeed';
import type { SalesSpeedResult } from './ozonSalesSpeed';

// ===== Часть 2: остатки по кластерам, покрытие, рекомендации, заказ на фабрике =====

export interface OzonCoverageSettings {
  /** Полных недель для расчёта скорости продаж. */
  speedWeeks: number;
  /** Неснижаемый остаток, дней продаж. */
  minStockDays: number;
  /** Целевой запас на Ozon, дней. Неснижаемый остаток входит ВНУТРЬ этого срока, а не прибавляется к нему. */
  targetStockDays: number;
  /** Максимальный срок продаж кластера после поставки, дней. 0 или отсутствие значения — отсекатель выключен. */
  maxClusterDays?: number;
  /** Объём заказа на фабрике, дней. */
  factoryOrderDays: number;
  /** % возвратов, возвращающихся в продажу (0–100). */
  returnsToSalePct: number;
  /** КластерID без поставок, через запятую. */
  excludedClusters: string;
  /** Приоритетные кластеры в формате «КластерID:коэффициент», через запятую. */
  priorityClusters?: string;
  /** Пункт 42. Порог дефицита, дней. 0 или отсутствие значения — коррекция скорости выключена. */
  deficitDays?: number;
  /** Пункт 42. Окно тренда, недель. */
  trendWeeks?: number;
  /** Пункт 42. Лучших недель окна для коррекции скорости. */
  bestWeeks?: number;
  /** Пункт 42. Минимум продаж за окно тренда для коррекции, шт. */
  minSalesForCorrection?: number;
  /** Пункт 42. Максимальный рост скорости при дефиците, раз. Меньше 1 — предел не применяется. */
  maxSpeedGrowth?: number;
  /** Пункт 38. Прирост объёма продаж, %: ручная надбавка к прогнозной скорости в контуре заказа на фабрике. */
  salesGrowthPct?: number;
  /** Item 73. «Рост спроса, %»: the last 7 days against the speed window; above it the larger speed is used. 0 — off. */
  demandGrowthPct?: number;
  /** Item 78b. Capital turnover: the period in days. */
  turnoverPeriodDays?: number;
  /** Item 78b. Slow: one turn takes longer than this many days. */
  turnoverSlowDays?: number;
  /** Item 78b. Leader: one turn takes fewer than this many days. */
  turnoverFastDays?: number;
  /** Item 78e. GMROI at or above this % is green. */
  gmroiGreenPct?: number;
  /** Item 78e. GMROI below this % is red; between the two — yellow. */
  gmroiRedPct?: number;
  /** Item 86, step C (owner, 26.09.2026): «Срок доставки до Ozon, дней» — how long a supply
   *  travels while the cluster keeps selling. NOT multiplied by the priority coefficient (a
   *  faraway cluster does not travel faster because it is important). Absent or 0 — no delay is
   *  planned for (old behaviour). Default when the setting is missing is 7 — see the getters
   *  in `Code.gs` and `useWarehouseStore.ts`. */
  deliveryToOzonDays?: number;
}

export interface OzonClusterRef {
  clusterId: string;
  clusterName: string;
}

/** Разбор настройки excludedClusters (CSV КластерID) в множество. */
export function parseExcludedClusters(csv: string): Set<string> {
  return new Set(String(csv || '').split(',').map(s => s.trim()).filter(Boolean));
}

/**
 * Разбор настройки priorityClusters («КластерID:коэффициент» через запятую) в карту коэффициентов.
 * Некорректные и меньшие единицы коэффициенты игнорируются: приоритет не может понижать запас.
 */
export function parsePriorityClusters(csv: string): Record<string, number> {
  const map: Record<string, number> = {};
  const parts = String(csv || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const [rawId, rawK] = part.split(':');
    const id = String(rawId || '').trim();
    if (!id) continue;
    const k = Number(String(rawK || '').trim().replace(',', '.'));
    map[id] = isNaN(k) || k < 1 ? 1.5 : k;
  }
  return map;
}

/** Карта «название кластера -> КластерID» по справочнику «Кластеры Ozon». */
export function buildClusterNameToId(clusters: OzonClusterRef[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const c of clusters) {
    const name = String(c.clusterName || '').trim();
    const id = String(c.clusterId || '').trim();
    if (name && id) map[name] = id;
  }
  return map;
}

export interface ClusterStockAgg {
  clusterId: string;
  clusterName: string;
  available: number;
  transit: number;
  returns: number;
  /** «В заявках» по данным Ozon, шт. */
  requested: number;
  /** Item 85. On the shelf = Доступно + Возвраты × %возвратов. */
  shelf: number;
  /** Item 85. On their way by Ozon's own columns = «В пути» + «В заявках». */
  ozonInFlight: number;
}

export interface ArticleStockAgg {
  article: string;
  /** Item 85. On the shelf over ALL rows of the article, rows without КластерID included. */
  totalShelf: number;
  /** Item 85. On the shelf in rows without КластерID (totals only, never a cluster). */
  unboundShelf: number;
  /** Item 85. «В пути» + «В заявках» in rows without КластерID. */
  unboundOzonInFlight: number;
  /** Кластерные агрегаты, ключ — КластерID. */
  byCluster: Record<string, ClusterStockAgg>;
}

/**
 * Агрегация остатков Ozon по товарам и кластерам.
 * Item 85, step 1.1: the stock is kept in two parts. ON THE SHELF = Доступно + Возвраты ×
 * %возвратов. ON THEIR WAY by Ozon = «В пути» + «В заявках» — kept apart because the same
 * pieces are also known from our own supplies (buildPendingSupplies) and the coverage takes
 * the larger of the two, never the sum. «Готовим к продаже» does not count (unchanged, TZ v3).
 * Строки без КластерID попадают только в итоги товара (unbound*).
 */
export function buildClusterStocks(
  stocks: OzonStockRow[],
  skus: SKUItem[],
  returnsToSalePct: number
): Record<string, ArticleStockAgg> {
  const pct = (Number(returnsToSalePct) || 0) / 100;
  const result: Record<string, ArticleStockAgg> = {};

  for (const row of stocks) {
    const article = resolveOzonArticle(skus, row.offerId, row.sku);
    if (!result[article]) {
      result[article] = { article, totalShelf: 0, unboundShelf: 0, unboundOzonInFlight: 0, byCluster: {} };
    }
    const agg = result[article];

    const available = Number(row.available) || 0;
    const transit = Number(row.transit) || 0;
    const returns = Number(row.returns) || 0;
    const requested = Number(row.requested) || 0;
    const shelf = available + returns * pct;

    agg.totalShelf += shelf;

    const clusterId = String(row.clusterId || '').trim();
    if (!clusterId) {
      agg.unboundShelf += shelf;
      agg.unboundOzonInFlight += transit + requested;
      continue;
    }
    if (!agg.byCluster[clusterId]) {
      agg.byCluster[clusterId] = {
        clusterId,
        clusterName: String(row.clusterName || '').trim(),
        available: 0,
        transit: 0,
        returns: 0,
        requested: 0,
        shelf: 0,
        ozonInFlight: 0
      };
    }
    const c = agg.byCluster[clusterId];
    c.available += available;
    c.transit += transit;
    c.returns += returns;
    c.requested += requested;
    c.shelf += shelf;
    c.ozonInFlight += transit + requested;
  }

  return result;
}

export interface ClusterShareWindow {
  /** Full weeks used, ascending (present in data, «Дней» = 7). */
  weeks: string[];
  /** Item 71. Monday of the current week when its partial row entered the window; null otherwise. */
  currentWeek: string | null;
  /** Elapsed days of the current week counted in the window (0 — it did not enter). */
  currentWeekDays: number;
  /** weeks.length, plus one more when the current part-week entered — for the tooltip («за N нед.»). */
  windowWeeksLabel: number;
  /** Sold per article over the window, incl. rows without a cluster («Без кластера»). */
  qtyByArticle: Record<string, number>;
  /** Sold per article and cluster over the window (incl. «Без кластера»). */
  qtyByArticleCluster: Record<string, Record<string, number>>;
}

/**
 * Item 86, step B (owner, 26.09.2026): «Остатки Озон» rework. Replaces item 72's per-cluster
 * deficit lift — two lifts of one empty cluster (item 42's article lift AND item 72's own)
 * could overstock it. A cluster that stood empty in the SHORT speed window (`speedWeeks`) still
 * sold in the LONGER trend window: instead of guessing its speed from its own best weeks, it
 * gets a SHARE of the article's (already corrected) speed equal to its share of the article's
 * sales over that longer window — see `rebuildClusterSpeedByShare`.
 * Window = max(trendWeeks, speedWeeks) full weeks PRESENT in data (same presence rule as
 * `buildSalesTrend`) plus the current part-week (item 71 rule of `buildSalesSpeed`), so the
 * short speed window always sits inside this one — a cluster with any sales in the short window
 * necessarily has sales here too.
 * 28-day archive rows never enter: full weeks require «Дней» = 7 exactly, and the current
 * part-week row is always < 7 days by definition.
 * Function is pure: it only reads `sales`, never mutates anything.
 */
export function buildClusterShareWindow(
  sales: OzonSalesRow[],
  skus: SKUItem[],
  weeksCount: number,
  now: Date,
  offerIdToArticle?: Record<string, string>
): ClusterShareWindow {
  const presentWeeks = new Set<string>();
  for (const row of sales) {
    if ((Number(row.days) || 0) === 7) presentWeeks.add(String(row.week || '').trim());
  }
  const weeks = getLastFullWeeks(now, weeksCount).filter(w => presentWeeks.has(w));
  const weekSet = new Set(weeks);

  // Item 71. Same rule as buildSalesSpeed: the current week's partial row, by its elapsed days.
  const current = getMskWeekMonday(now);
  let currentWeekDays = 0;
  for (const row of sales) {
    if (String(row.week || '').trim() !== current) continue;
    const days = Number(row.days) || 0;
    if (days > 0 && days < 7 && days > currentWeekDays) currentWeekDays = days;
  }
  const isCurrentPartial = (row: OzonSalesRow): boolean =>
    currentWeekDays > 0 && String(row.week || '').trim() === current && (Number(row.days) || 0) < 7;

  const qtyByArticle: Record<string, number> = {};
  const qtyByArticleCluster: Record<string, Record<string, number>> = {};
  for (const row of sales) {
    const week = String(row.week || '').trim();
    if (isCurrentPartial(row)) {
      // counted below, like any week of the window
    } else {
      if ((Number(row.days) || 0) !== 7) continue;
      if (!weekSet.has(week)) continue;
    }

    const qty = Number(row.qty) || 0;
    if (qty === 0) continue;

    const article = resolveSalesArticle(skus, row.offerId, offerIdToArticle);
    const clusterName = String(row.clusterName || '').trim() || NO_CLUSTER_NAME;
    qtyByArticle[article] = (qtyByArticle[article] || 0) + qty;
    if (!qtyByArticleCluster[article]) qtyByArticleCluster[article] = {};
    qtyByArticleCluster[article][clusterName] = (qtyByArticleCluster[article][clusterName] || 0) + qty;
  }

  return {
    weeks,
    currentWeek: currentWeekDays > 0 ? current : null,
    currentWeekDays,
    windowWeeksLabel: weeks.length + (currentWeekDays > 0 ? 1 : 0),
    qtyByArticle,
    qtyByArticleCluster
  };
}

/**
 * Item 86, step B. Rebuilds `speed.perDayByArticleCluster` AFTER every article-level speed pass
 * (item 42 deficit correction, item 73 demand growth) as `perDayByArticle[article] × share`,
 * share = qty of the cluster in `shareWindow` ÷ total qty of the article in `shareWindow`
 * (denominator includes rows without a cluster, «Без кластера» — its own share stays unbound).
 * Invariant: Σ over clusters (incl. no-cluster) of the rebuilt speed = perDayByArticle[article].
 * Fallback (should not happen: sales only in weeks the share window filtered out as corrupted):
 * an article with speed > 0 but NO sales at all in the share window keeps the short-window
 * split (`speed.clusterSharesPctByArticle`, built once in `buildSalesSpeed` and never mutated
 * by the speed passes) instead of losing every cluster.
 * Mutates `speed.perDayByArticleCluster` in place; returns the share, in %, actually applied per
 * article and cluster — for display only (the tooltip «доля кластера в продажах»).
 */
export function rebuildClusterSpeedByShare(
  speed: SalesSpeedResult,
  shareWindow: ClusterShareWindow
): Record<string, Record<string, number>> {
  const sharePctByArticleCluster: Record<string, Record<string, number>> = {};
  const articles = new Set<string>([
    ...Object.keys(speed.perDayByArticle),
    ...Object.keys(shareWindow.qtyByArticleCluster)
  ]);
  for (const article of articles) {
    const perDay = Number(speed.perDayByArticle[article]) || 0;
    const windowQty = shareWindow.qtyByArticle[article] || 0;
    const clusterQty = shareWindow.qtyByArticleCluster[article] || {};
    const fresh: Record<string, number> = {};
    const pct: Record<string, number> = {};

    if (windowQty > 0) {
      for (const clusterName of Object.keys(clusterQty)) {
        const share = clusterQty[clusterName] / windowQty;
        fresh[clusterName] = perDay * share;
        pct[clusterName] = share * 100;
      }
    } else if (perDay > 0) {
      // Fallback: nothing sold anywhere in the share window — split by the short window instead.
      const shortShares = speed.clusterSharesPctByArticle[article] || {};
      for (const clusterName of Object.keys(shortShares)) {
        fresh[clusterName] = perDay * (shortShares[clusterName] / 100);
        pct[clusterName] = shortShares[clusterName];
      }
    }

    speed.perDayByArticleCluster[article] = fresh;
    sharePctByArticleCluster[article] = pct;
  }
  return sharePctByArticleCluster;
}
