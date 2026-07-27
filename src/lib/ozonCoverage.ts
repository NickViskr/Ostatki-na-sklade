import { OzonSalesRow, OzonStockRow, SKUItem } from '../types';

// ===== Модуль планирования поставок Ozon =====
// Часть 1: недели по МСК, сопоставление артикулов, скорость продаж.
// Все функции чистые: без обращения к стору, без побочных эффектов.

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Название кластера для продаж, не привязанных к кластеру (как пишет прокси). */
export const NO_CLUSTER_NAME = 'Без кластера';

/**
 * Понедельник недели по московскому времени для переданной даты.
 * Формат результата: 'yyyy-MM-dd' — совпадает с колонкой «Неделя» листа «Продажи Ozon».
 */
export function getMskWeekMonday(date: Date): string {
  const msk = new Date(date.getTime() + MSK_OFFSET_MS);
  const day = msk.getUTCDay();
  const diff = (day + 6) % 7;
  const monday = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() - diff));
  return monday.toISOString().slice(0, 10);
}

/**
 * Понедельники последних count ПОЛНЫХ недель по МСК, по возрастанию.
 * Текущая незавершённая неделя в список не входит.
 */
export function getLastFullWeeks(now: Date, count: number): string[] {
  const currentMonday = new Date(getMskWeekMonday(now) + 'T00:00:00Z');
  const weeks: string[] = [];
  for (let i = count; i >= 1; i--) {
    weeks.push(new Date(currentMonday.getTime() - i * WEEK_MS).toISOString().slice(0, 10));
  }
  return weeks;
}

/**
 * Сопоставление артикула Ozon с внутренним SKU (та же логика, что в ozonMatch):
 * 1) по «ШК Ozon» (числовой SKU Ozon), 2) по совпадению offer_id с внутренним артикулом.
 * Если не сопоставлено — возвращается offer_id как есть.
 */
export function resolveOzonArticle(skus: SKUItem[], offerId: string, ozonSku?: string): string {
  const offer = String(offerId || '').trim();
  const ozon = String(ozonSku || '').trim();
  if (ozon) {
    const byBarcode = skus.find(s => String(s.ozonBarcode || '').trim() === ozon);
    if (byBarcode) return byBarcode.sku;
  }
  if (offer) {
    const bySku = skus.find(s => s.sku.toLowerCase() === offer.toLowerCase());
    if (bySku) return bySku.sku;
  }
  return offer || ozon || 'НЕИЗВЕСТНО';
}

export interface SalesSpeedResult {
  /** Понедельники недель окна расчёта, по возрастанию. */
  weeks: string[];
  /** Длина окна в днях (= weeks.length * 7). */
  windowDays: number;
  /** Всего продано за окно, шт (все товары, все кластеры, включая «Без кластера»). */
  totalQty: number;
  /** Общая скорость продаж, шт/день. */
  totalPerDay: number;
  /** Продано за окно по внутреннему артикулу, шт. */
  qtyByArticle: Record<string, number>;
  /** Скорость по внутреннему артикулу, шт/день. */
  perDayByArticle: Record<string, number>;
  /** Продано за окно по названию кластера, шт (включая «Без кластера»). */
  qtyByCluster: Record<string, number>;
  /** Продано за окно: артикул -> название кластера -> шт. */
  qtyByArticleCluster: Record<string, Record<string, number>>;
  /** Скорость: артикул -> название кластера -> шт/день. */
  perDayByArticleCluster: Record<string, Record<string, number>>;
  /** Доли кластеров в продажах по всем товарам, % (0–100, без округления). */
  clusterSharesPct: Record<string, number>;
  /** Доли кластеров в продажах каждого товара, %: артикул -> кластер -> %. */
  clusterSharesPctByArticle: Record<string, Record<string, number>>;
}

/**
 * Скорость продаж по последним полным неделям.
 * По ТЗ v3: скорость = сумма продаж за weeks ÷ (число недель × 7 дней).
 * В расчёт берутся только строки листа «Продажи Ozon», чья «Неделя» входит в weeks
 * (28-дневные блоки в это окно попасть не могут — они старше свежей зоны).
 */
export function buildSalesSpeed(sales: OzonSalesRow[], skus: SKUItem[], weeks: string[]): SalesSpeedResult {
  const weekSet = new Set(weeks);
  const windowDays = weeks.length * 7;

  let totalQty = 0;
  const qtyByArticle: Record<string, number> = {};
  const qtyByCluster: Record<string, number> = {};
  const qtyByArticleCluster: Record<string, Record<string, number>> = {};

  for (const row of sales) {
    const week = String(row.week || '').trim();
    if (!weekSet.has(week)) continue;

    const qty = Number(row.qty) || 0;
    if (qty === 0) continue;

    const article = resolveOzonArticle(skus, row.offerId);
    const clusterName = String(row.clusterName || '').trim() || NO_CLUSTER_NAME;

    totalQty += qty;
    qtyByArticle[article] = (qtyByArticle[article] || 0) + qty;
    qtyByCluster[clusterName] = (qtyByCluster[clusterName] || 0) + qty;
    if (!qtyByArticleCluster[article]) qtyByArticleCluster[article] = {};
    qtyByArticleCluster[article][clusterName] = (qtyByArticleCluster[article][clusterName] || 0) + qty;
  }

  const perDayByArticle: Record<string, number> = {};
  for (const article of Object.keys(qtyByArticle)) {
    perDayByArticle[article] = windowDays > 0 ? qtyByArticle[article] / windowDays : 0;
  }

  const perDayByArticleCluster: Record<string, Record<string, number>> = {};
  for (const article of Object.keys(qtyByArticleCluster)) {
    perDayByArticleCluster[article] = {};
    for (const clusterName of Object.keys(qtyByArticleCluster[article])) {
      perDayByArticleCluster[article][clusterName] =
        windowDays > 0 ? qtyByArticleCluster[article][clusterName] / windowDays : 0;
    }
  }

  const clusterSharesPct: Record<string, number> = {};
  for (const clusterName of Object.keys(qtyByCluster)) {
    clusterSharesPct[clusterName] = totalQty > 0 ? (qtyByCluster[clusterName] / totalQty) * 100 : 0;
  }

  const clusterSharesPctByArticle: Record<string, Record<string, number>> = {};
  for (const article of Object.keys(qtyByArticleCluster)) {
    clusterSharesPctByArticle[article] = {};
    const articleQty = qtyByArticle[article] || 0;
    for (const clusterName of Object.keys(qtyByArticleCluster[article])) {
      clusterSharesPctByArticle[article][clusterName] =
        articleQty > 0 ? (qtyByArticleCluster[article][clusterName] / articleQty) * 100 : 0;
    }
  }

  return {
    weeks,
    windowDays,
    totalQty,
    totalPerDay: windowDays > 0 ? totalQty / windowDays : 0,
    qtyByArticle,
    perDayByArticle,
    qtyByCluster,
    qtyByArticleCluster,
    perDayByArticleCluster,
    clusterSharesPct,
    clusterSharesPctByArticle
  };
}

// ===== Часть 2: остатки по кластерам, покрытие, рекомендации, заказ на фабрике =====

export interface OzonCoverageSettings {
  /** Полных недель для расчёта скорости продаж. */
  speedWeeks: number;
  /** Неснижаемый остаток, дней продаж. */
  minStockDays: number;
  /** Целевой запас на Ozon, дней. */
  targetStockDays: number;
  /** Объём заказа на фабрике, дней. */
  factoryOrderDays: number;
  /** % возвратов, возвращающихся в продажу (0–100). */
  returnsToSalePct: number;
  /** КластерID без поставок, через запятую. */
  excludedClusters: string;
}

export interface OzonClusterRef {
  clusterId: string;
  clusterName: string;
}

/** Разбор настройки excludedClusters (CSV КластерID) в множество. */
export function parseExcludedClusters(csv: string): Set<string> {
  return new Set(String(csv || '').split(',').map(s => s.trim()).filter(Boolean));
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
  /** Расчётный остаток = Доступно + В пути + Возвраты × %возвратов. */
  estimated: number;
}

export interface ArticleStockAgg {
  article: string;
  /** Расчётный остаток по ВСЕМ строкам товара, включая строки без КластерID. */
  totalEstimated: number;
  /** Расчётный остаток строк без КластерID (в общие итоги, но не в кластеры). */
  unboundEstimated: number;
  /** Кластерные агрегаты, ключ — КластерID. */
  byCluster: Record<string, ClusterStockAgg>;
}

/**
 * Агрегация остатков Ozon по товарам и кластерам.
 * По ТЗ v3: расчётный остаток = Доступно + В пути + Возвраты × %возвратов;
 * «Готовим к продаже» и «В заявках» в расчёт не входят.
 * Строки без КластерID попадают только в totalEstimated / unboundEstimated.
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
      result[article] = { article, totalEstimated: 0, unboundEstimated: 0, byCluster: {} };
    }
    const agg = result[article];

    const available = Number(row.available) || 0;
    const transit = Number(row.transit) || 0;
    const returns = Number(row.returns) || 0;
    const estimated = available + transit + returns * pct;

    agg.totalEstimated += estimated;

    const clusterId = String(row.clusterId || '').trim();
    if (!clusterId) {
      agg.unboundEstimated += estimated;
      continue;
    }
    if (!agg.byCluster[clusterId]) {
      agg.byCluster[clusterId] = {
        clusterId,
        clusterName: String(row.clusterName || '').trim(),
        available: 0,
        transit: 0,
        returns: 0,
        estimated: 0
      };
    }
    const c = agg.byCluster[clusterId];
    c.available += available;
    c.transit += transit;
    c.returns += returns;
    c.estimated += estimated;
  }

  return result;
}

/**
 * Покрытие в днях.
 * Обычный кластер: (расчётный остаток − скорость × неснижаемые дни) ÷ скорость.
 * Исключённый кластер (без поставок): неснижаемый запас не применяется — остаток ÷ скорость.
 * Скорость 0 — покрытие не определено (null, трактуется как «бесконечное»).
 */
export function calcCoverageDays(
  estimated: number,
  perDay: number,
  minStockDays: number,
  excluded: boolean
): number | null {
  if (!(perDay > 0)) return null;
  if (excluded) return estimated / perDay;
  return (estimated - perDay * minStockDays) / perDay;
}

export interface SupplyRecommendation {
  /** Расчётная потребность, шт (до ограничения Моим складом и округления). */
  neededQty: number;
  /** Рекомендовано коробок (округление вверх, с ограничением Моим складом). */
  boxes: number;
  /** Рекомендовано штук = boxes × pcsPerBox. */
  qty: number;
  /** true, если рекомендация урезана остатком Моего склада. */
  limitedByMyStock: boolean;
}

/**
 * Рекомендация поставки в кластер.
 * Выдаётся только при покрытии ниже целевого запаса.
 * нужно = скорость × (целевой запас + неснижаемые дни) − расчётный остаток;
 * округление ВВЕРХ до целых коробок; ограничение остатком Моего склада (в целых коробках).
 */
export function calcSupplyRecommendation(
  perDay: number,
  estimated: number,
  settings: OzonCoverageSettings,
  pcsPerBox: number,
  myStockAvailable: number
): SupplyRecommendation | null {
  if (!(perDay > 0)) return null;
  const coverage = calcCoverageDays(estimated, perDay, settings.minStockDays, false);
  if (coverage === null || coverage >= settings.targetStockDays) return null;

  const need = perDay * (settings.targetStockDays + settings.minStockDays) - estimated;
  if (need <= 0) return null;

  const box = pcsPerBox > 0 ? pcsPerBox : 1;
  const boxesNeeded = Math.ceil(need / box);
  const maxBoxes = Math.floor(Math.max(0, myStockAvailable) / box);
  const boxes = Math.min(boxesNeeded, maxBoxes);

  return {
    neededQty: need,
    boxes,
    qty: boxes * box,
    limitedByMyStock: boxes < boxesNeeded
  };
}

export interface FactorySignal {
  /** На сколько дней хватит: (остаток всех кластеров + Мой склад) ÷ скорость. */
  daysLeft: number;
  /** Объём заказа, шт = скорость × дни заказа, округление вверх. */
  orderQty: number;
  /** Тот же объём в коробках, округление вверх. */
  orderBoxes: number;
}

/**
 * Сигнал «пора заказать на фабрике».
 * Срабатывает при (расчётный остаток всех кластеров + Мой склад) ÷ скорость < срок поставки + неснижаемые дни.
 * Остатки исключённых кластеров и строки без КластерID входят в общий остаток.
 */
export function calcFactorySignal(
  totalEstimated: number,
  myStockAvailable: number,
  perDay: number,
  leadTimeDays: number,
  pcsPerBox: number,
  settings: OzonCoverageSettings
): FactorySignal | null {
  if (!(perDay > 0)) return null;
  const daysLeft = (totalEstimated + Math.max(0, myStockAvailable)) / perDay;
  if (daysLeft >= (Number(leadTimeDays) || 0) + settings.minStockDays) return null;
  const box = pcsPerBox > 0 ? pcsPerBox : 1;
  const orderQty = Math.ceil(perDay * settings.factoryOrderDays);
  return { daysLeft, orderQty, orderBoxes: Math.ceil(orderQty / box) };
}

export interface ClusterCoverageRow {
  clusterId: string;
  clusterName: string;
  qtySold: number;
  perDay: number;
  /** Доля кластера в продажах этого товара, % (0–100). */
  sharePct: number;
  available: number;
  transit: number;
  returns: number;
  estimated: number;
  coverageDays: number | null;
  excluded: boolean;
  recommendation: SupplyRecommendation | null;
}

export interface ArticleCoverage {
  article: string;
  qtySold: number;
  perDay: number;
  pcsPerBox: number;
  leadTimeDays: number;
  myStockAvailable: number;
  totalEstimated: number;
  unboundEstimated: number;
  /** Продажи товара, не привязанные к кластеру («Без кластера» и неизвестные названия), шт. */
  unboundQtySold: number;
  clusters: ClusterCoverageRow[];
  factory: FactorySignal | null;
}

export interface OzonCoverageInput {
  stocks: OzonStockRow[];
  sales: OzonSalesRow[];
  skus: SKUItem[];
  clusters: OzonClusterRef[];
  settings: OzonCoverageSettings;
  /** Доступность на Моём складе по артикулу (виртуальные комплекты уже учтены вызывающей стороной). */
  myStockAvailability: Record<string, number>;
  /** Момент расчёта; по умолчанию — текущее время. */
  now?: Date;
}

export interface OzonCoverageResult {
  speed: SalesSpeedResult;
  articles: ArticleCoverage[];
}

/**
 * Сборный расчёт покрытия и рекомендаций по всем товарам.
 * Товары — объединение артикулов из остатков Ozon и продаж за окно скорости.
 */
export function buildOzonCoverage(input: OzonCoverageInput): OzonCoverageResult {
  const now = input.now || new Date();
  const speedWeeks = input.settings.speedWeeks > 0 ? input.settings.speedWeeks : 4;
  const weeks = getLastFullWeeks(now, speedWeeks);
  const speed = buildSalesSpeed(input.sales, input.skus, weeks);
  const stocksByArticle = buildClusterStocks(input.stocks, input.skus, input.settings.returnsToSalePct);
  const nameToId = buildClusterNameToId(input.clusters);
  const excludedIds = parseExcludedClusters(input.settings.excludedClusters);

  const articleSet = new Set<string>([
    ...Object.keys(stocksByArticle),
    ...Object.keys(speed.qtyByArticle)
  ]);

  const articles: ArticleCoverage[] = [];

  for (const article of articleSet) {
    const stockAgg = stocksByArticle[article] || { article, totalEstimated: 0, unboundEstimated: 0, byCluster: {} };
    const skuItem = input.skus.find(s => s.sku === article);
    const pcsPerBox = skuItem && skuItem.pcsPerBox > 0 ? skuItem.pcsPerBox : 1;
    const leadTimeDays = skuItem ? (Number(skuItem.leadTimeDays) || 0) : 0;
    const myStockAvailable = Number(input.myStockAvailability[article]) || 0;

    const qtyByClusterId: Record<string, number> = {};
    const perDayByClusterId: Record<string, number> = {};
    const clusterNamesById: Record<string, string> = {};
    let unboundQtySold = 0;

    const articleClusterQty = speed.qtyByArticleCluster[article] || {};
    const articleClusterPerDay = speed.perDayByArticleCluster[article] || {};
    for (const clusterName of Object.keys(articleClusterQty)) {
      const qty = articleClusterQty[clusterName];
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

    const clusterIds = new Set<string>([
      ...Object.keys(stockAgg.byCluster),
      ...Object.keys(qtyByClusterId)
    ]);

    const clusterRows: ClusterCoverageRow[] = [];
    for (const clusterId of clusterIds) {
      const st = stockAgg.byCluster[clusterId];
      const perDay = perDayByClusterId[clusterId] || 0;
      const qtySold = qtyByClusterId[clusterId] || 0;
      const isExcluded = excludedIds.has(clusterId);
      const estimated = st ? st.estimated : 0;
      const coverage = calcCoverageDays(estimated, perDay, input.settings.minStockDays, isExcluded);
      const recommendation = isExcluded
        ? null
        : calcSupplyRecommendation(perDay, estimated, input.settings, pcsPerBox, myStockAvailable);

      clusterRows.push({
        clusterId,
        clusterName: (st && st.clusterName) || clusterNamesById[clusterId] || clusterId,
        qtySold,
        perDay,
        sharePct: articleQtySold > 0 ? (qtySold / articleQtySold) * 100 : 0,
        available: st ? st.available : 0,
        transit: st ? st.transit : 0,
        returns: st ? st.returns : 0,
        estimated,
        coverageDays: coverage,
        excluded: isExcluded,
        recommendation
      });
    }
    clusterRows.sort((a, b) => b.qtySold - a.qtySold);

    const perDay = speed.perDayByArticle[article] || 0;
    const factory = calcFactorySignal(
      stockAgg.totalEstimated,
      myStockAvailable,
      perDay,
      leadTimeDays,
      pcsPerBox,
      input.settings
    );

    articles.push({
      article,
      qtySold: articleQtySold,
      perDay,
      pcsPerBox,
      leadTimeDays,
      myStockAvailable,
      totalEstimated: stockAgg.totalEstimated,
      unboundEstimated: stockAgg.unboundEstimated,
      unboundQtySold,
      clusters: clusterRows,
      factory
    });
  }

  articles.sort((a, b) => b.perDay - a.perDay);

  return { speed, articles };
}

