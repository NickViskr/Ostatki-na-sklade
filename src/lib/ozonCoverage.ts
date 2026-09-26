import { FactoryOrder, KitItem, OzonSalesRow, OzonStockRow, SKUItem } from '../types';

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

/**
 * Пункт 39A. Карта «артикул Ozon (offer_id) в нижнем регистре -> внутренний артикул»,
 * построенная ПО ОСТАТКАМ полным сопоставлением resolveOzonArticle (с «ШК Ozon»).
 * Зачем: в листе «Продажи Ozon» колонки «ШК Ozon» нет, поэтому продажи умеют связываться
 * только по имени артикула. Товар, у которого связь идёт через «ШК Ozon», разъехался бы на
 * два фантомных артикула: один с остатком и нулевой скоростью, другой со скоростью без остатка.
 * Замер боевой базы 19.08.2026: дефект пока не проявляется — все 12 артикулов остатков нашлись
 * в SKU Базе по имени (8 из 19 баркодов записаны с префиксом OZN, а Ozon отдаёт голое число,
 * поэтому путь через «ШК Ozon» почти не срабатывает). Именно поэтому он и незаметен.
 * Первое значение выигрывает: строк остатков по одному offer_id много (склады, кластеры).
 */
export function buildOfferIdToArticle(stocks: OzonStockRow[], skus: SKUItem[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of stocks) {
    const key = String(row.offerId || '').trim().toLowerCase();
    if (!key || map[key]) continue;
    map[key] = resolveOzonArticle(skus, row.offerId, row.sku);
  }
  return map;
}

/**
 * Пункт 39A. Артикул строки ПРОДАЖ: сначала карта, построенная по остаткам
 * (buildOfferIdToArticle), иначе прежнее сопоставление по одному offer_id.
 * Карта необязательна: без неё поведение ровно такое, каким было раньше.
 */
export function resolveSalesArticle(
  skus: SKUItem[],
  offerId: string,
  offerIdToArticle?: Record<string, string>
): string {
  const key = String(offerId || '').trim().toLowerCase();
  if (offerIdToArticle && key && offerIdToArticle[key]) return offerIdToArticle[key];
  return resolveOzonArticle(skus, offerId);
}

export interface SalesSpeedResult {
  /** ФАКТИЧЕСКИ использованные недели окна, по возрастанию: запрошенные минус отсутствующие в данных. */
  weeks: string[];
  /** Длина окна в днях (= weeks.length * 7 + currentWeekDays). */
  windowDays: number;
  /** Item 71. Monday of the current week when its partial row entered the window; null otherwise. */
  currentWeek: string | null;
  /** Item 71. Elapsed days of the current week counted in the window (0 when it did not enter). */
  currentWeekDays: number;
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
 * По ТЗ v3: скорость = сумма продаж за окно ÷ (число недель окна × 7 дней).
 * Пункт 39B. В расчёт берутся ТОЛЬКО недельные строки («Дней» = 7) — так же, как в
 * applyDeficitSpeedCorrection и buildSalesTrend. Замер боевой базы 19.08.2026: в листе
 * «Продажи Ozon» две зоны хранения — недельная (1385 строк, «Дней» = 7, 18.05.2026–17.08.2026)
 * и архивная (1805 строк, «Дней» = 28, 16.06.2025–20.04.2026). Даты 28-дневных блоков — тоже
 * понедельники и стоят ровно на сетке getLastFullWeeks, поэтому окна 4 и 13 недель помещаются
 * в недельную зону лишь по случайности: при окне 17 недель блок 20.04 зачёлся бы как неделя
 * и завысил скорость вчетверо.
 * Знаменатель — не «сколько недель заказали», а сколько недель окна РЕАЛЬНО есть в данных
 * (неделя присутствует, если по ней пришла хотя бы одна строка с «Дней» = 7 у любого товара
 * и кластера). Иначе окно глубже недельной зоны молча занижало бы скорость.
 *
 * Item 71 (owner, 18.09.2026: «полные недели не позволяют отслеживать оперативно возросшие
 * продажи»). The CURRENT week enters the window too, by its actual length: the poll writes
 * its row with «Дней» = days elapsed since Monday МСК (a fraction, see `saveOzonSales`), so
 * the window is `weeks × 7 + elapsed` days and the freshest sale counted is yesterday's, not
 * last Sunday's. A current-week row still carrying «Дней» = 7 was written before that change
 * and is left out — counting a part-week as a whole would understate the speed. Pass
 * `currentWeek` (Monday of the week `now` falls in, МСК) to enable; without it the old
 * full-weeks-only window stands, which is what the deficit correction and the trend keep.
 */
export function buildSalesSpeed(
  sales: OzonSalesRow[],
  skus: SKUItem[],
  weeks: string[],
  offerIdToArticle?: Record<string, string>,
  currentWeek?: string
): SalesSpeedResult {
  const presentWeeks = new Set<string>();
  for (const row of sales) {
    if ((Number(row.days) || 0) === 7) presentWeeks.add(String(row.week || '').trim());
  }
  const usedWeeks = weeks.filter(w => presentWeeks.has(w));
  const weekSet = new Set(usedWeeks);

  // Item 71. The partial row of the current week: every row of that week carries the same
  // elapsed-days value (one poll writes them all), so the largest one seen is THE value.
  const current = String(currentWeek || '').trim();
  let currentWeekDays = 0;
  if (current) {
    for (const row of sales) {
      if (String(row.week || '').trim() !== current) continue;
      const days = Number(row.days) || 0;
      if (days > 0 && days < 7 && days > currentWeekDays) currentWeekDays = days;
    }
  }
  const isCurrentPartial = (row: OzonSalesRow): boolean =>
    currentWeekDays > 0 && String(row.week || '').trim() === current && (Number(row.days) || 0) < 7;
  const windowDays = usedWeeks.length * 7 + currentWeekDays;

  let totalQty = 0;
  const qtyByArticle: Record<string, number> = {};
  const qtyByCluster: Record<string, number> = {};
  const qtyByArticleCluster: Record<string, Record<string, number>> = {};

  for (const row of sales) {
    const week = String(row.week || '').trim();
    if (isCurrentPartial(row)) {
      // counted below like any week of the window
    } else {
      if ((Number(row.days) || 0) !== 7) continue;
      if (!weekSet.has(week)) continue;
    }

    const qty = Number(row.qty) || 0;
    if (qty === 0) continue;

    const article = resolveSalesArticle(skus, row.offerId, offerIdToArticle);
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
    weeks: usedWeeks,
    windowDays,
    currentWeek: currentWeekDays > 0 ? current : null,
    currentWeekDays,
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

/**
 * Item 85, step 1.8 (owner 2026-09-26). The colour of «Покрытие» follows the SAME thresholds as
 * the recommendation, on the same figure (shelf + goods on their way): 'red' — below the
 * minimum stock; 'amber' — below the target, i.e. exactly when a supply is recommended;
 * 'green' — enough; 'none' — no sales, nothing to measure. The old colour compared «days above
 * the minimum» with the whole target: a cluster could be amber with no recommendation, and the
 * priority coefficient was ignored. An excluded cluster has no minimum (as in calcCoverageDays).
 *
 * Item 86, step C (owner, 26.09.2026): a settings.deliveryToOzonDays (D) widens both thresholds
 * by the time a supply spends on the road, D itself NOT multiplied by the priority coefficient:
 *   red   ⇔ coverageDays (days above the minimum, calcCoverageDays' own meaning) < D — a supply
 *           sent today would still arrive AFTER the stock crosses the minimum;
 *   amber ⇔ estimated < perDay × (targetStockDays × k + D) — exactly calcSupplyRecommendation's
 *           own «need > 0» (settings there already carries targetStockDays × k, D added once).
 * D = 0 reproduces the old thresholds exactly (0 < 0 is false, the amber term loses +D).
 */
export type CoverageTone = 'none' | 'red' | 'amber' | 'green';

export function coverageTone(
  estimated: number,
  perDay: number,
  settings: Pick<OzonCoverageSettings, 'minStockDays' | 'targetStockDays' | 'deliveryToOzonDays'>,
  priorityK: number = 1,
  excluded: boolean = false
): CoverageTone {
  if (!(perDay > 0)) return 'none';
  const D = Math.max(0, Number(settings.deliveryToOzonDays) || 0);
  const k = !excluded && priorityK > 1 ? priorityK : 1;
  if (!excluded) {
    const coverageDays = (estimated - perDay * settings.minStockDays * k) / perDay;
    if (coverageDays < D) return 'red';
  }
  if (estimated < perDay * (settings.targetStockDays * k + D)) return 'amber';
  return 'green';
}

export interface SupplyRecommendation {
  /** Расчётная потребность, шт (до ограничения Моим складом и округления). */
  neededQty: number;
  /** Item 51. Pieces to ship if stock were unlimited: whole boxes, or a partial one. */
  wantQty: number;
  /** Boxes recommended; a partial box still counts as a box. */
  boxes: number;
  /** Pieces recommended. A multiple of the box ALWAYS, except the partial box of item 51. */
  qty: number;
  /** true when the recommendation was cut down by the stock of «Мой склад». */
  limitedByMyStock: boolean;
  /** Item 51: the box is partial because a FULL one would bury a slow cluster. */
  partialByMaxDays: boolean;
  /** How many days a FULL box would last. 0 when the box is full. */
  fullBoxDays: number;
}

/**
 * Рекомендация поставки в кластер.
 * Пункт 34, дефект 1: неснижаемый остаток входит ВНУТРЬ целевого запаса, поэтому
 * нужно = скорость × целевой запас − расчётный остаток (без слагаемого minStockDays).
 * Порог включения рекомендации равен целевому запасу.
 * Пункт 34, дефект 2: rounding UP to whole boxes can bury a slow cluster under years of stock.
 * ITEM 51, owner's decision of 03.09.2026: such a cluster is NO LONGER dropped in silence —
 * it is offered a PARTIAL box holding exactly the need. The need is
 * perDay × targetStockDays − estimated, so after that delivery the cluster sits on exactly
 * the target stock and the maxClusterDays ceiling is never breached.
 * The cutoff stays as insurance and now fires only where the ceiling is BELOW the target
 * stock itself: there even the exact need breaches it, and the cluster gets no
 * recommendation — that is a settings mismatch, not a slow cluster.
 * ITEM 51, second half: the stock of «Мой склад» is also cut IN PIECES, not in whole boxes.
 * A cluster short of a full box used to get nothing at all.
 *
 * Item 86, step C (owner, 26.09.2026): a supply travels settings.deliveryToOzonDays (D) days
 * while the cluster keeps selling, so the need must cover the target stock PLUS that time on
 * the road: need = perDay × (targetStockDays + D) − estimated. D is NOT multiplied by the
 * priority coefficient — the caller already folds priority into targetStockDays (and
 * minStockDays) before calling this function, so D is added on top, once.
 * The maxClusterDays ceiling reads «days of sales left AFTER the supply arrives»: at arrival
 * (D days from now) perDay × D more pieces will have sold, so the days left are
 * (estimated + wantQty) / perDay − D, compared with maxDays. Same net-of-D figure is used for
 * the insurance return-null check and for fullBoxDays (the days a FULL box would leave AFTER
 * arrival) — one convention, so the UI hint stays true to what tripped the ceiling.
 * D = 0 reproduces the old numbers exactly.
 */
export function calcSupplyRecommendation(
  perDay: number,
  estimated: number,
  settings: OzonCoverageSettings,
  pcsPerBox: number,
  myStockAvailable: number
): SupplyRecommendation | null {
  if (!(perDay > 0)) return null;
  const D = Math.max(0, Number(settings.deliveryToOzonDays) || 0);

  const need = perDay * (settings.targetStockDays + D) - estimated;
  if (need <= 0) return null;

  const box = pcsPerBox > 0 ? pcsPerBox : 1;
  const boxesNeeded = Math.ceil(need / box);

  let wantQty = boxesNeeded * box;
  let partialByMaxDays = false;
  let fullBoxDays = 0;
  const maxDays = Number(settings.maxClusterDays) || 0;
  if (maxDays > 0 && (estimated + wantQty) / perDay - D > maxDays) {
    fullBoxDays = (estimated + wantQty) / perDay - D;
    wantQty = Math.ceil(need);
    partialByMaxDays = true;
    // Insurance: a ceiling below the target stock — not even the exact need fits under it.
    if ((estimated + wantQty) / perDay - D > maxDays) return null;
  }

  const stock = Math.floor(Math.max(0, myStockAvailable));
  const qty = Math.min(wantQty, stock);

  return {
    neededQty: need,
    wantQty,
    boxes: Math.ceil(qty / box),
    qty,
    limitedByMyStock: qty < wantQty,
    partialByMaxDays,
    fullBoxDays
  };
}

/** Дней, разделяющих две ISO-даты (toDay − fromDay), считается через UTC-полночь. */
export function daysBetweenIso(fromDay: string, toDay: string): number {
  const DAY_MS = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(toDay + 'T00:00:00Z') - Date.parse(fromDay + 'T00:00:00Z')) / DAY_MS);
}

export interface FactoryOnOrderResult {
  /** Заказано и ещё не получено, шт, по артикулу — то, что входит в ТРУБУ. */
  qty: Record<string, number>;
  /** Ручные заказы, скрытые из ТРУБЫ: по их артикулу есть активный заказ из Китая, а
   * владелец ещё не подтвердил, что это РАЗНЫЕ заказы. */
  hiddenManual: FactoryOrder[];
  /** Просроченные заказы из Китая (id → сколько дней просрочки). Ручные просроченные заказы
   * сюда не попадают — они просто выпадают из ТРУБЫ, как и раньше (пункт 35). */
  late: Record<string, number>;
}

/**
 * Пункт 83d/83e. ЕДИНОЕ правило «что считается заказанным на фабрике и ещё не полученным» —
 * общее для OzonStocksTab и Dashboard (иначе они неизбежно разойдутся), и зеркалируется на
 * сервере (Code.gs, `factoryPipelineQtyByArticleGs`) для отчёта до/после синхронизации.
 *
 * - 'received' и 'replaced' никогда не считаются: товар либо уже пришёл, либо ручной заказ
 *   закрыт как дубликат заказа из Китая.
 * - Ручной заказ (`source === ''`) выпадает из ТРУБЫ, если дата ожидания в прошлом — фабрика
 *   сорвала срок (правило пункта 35 без изменений).
 * - Заказ из Китая ('Китай' / 'Китай прогноз') остаётся в ТРУБЕ даже просроченным: недосчёт
 *   может лишь навести на мысль о лишнем заказе, а перебор — скрыть нехватку. `late` показывает,
 *   на сколько дней просрочка.
 * - An active manual row is hidden whenever the SAME article has a China row (active OR
 *   RECEIVED — a China row never disappears from `orders`, only its status changes) whose
 *   `orderedAt` (shipping date) is on or after the manual row's own `orderedAt`. From item 83
 *   on, China orders reach the warehouse only through the China module, so a China shipment
 *   no older than the manual order is that SAME order — arrival must not un-hide it, or the
 *   goods are counted twice (as received stock AND as the still-open manual order). Exception:
 *   `checked` (the owner confirmed «это разные заказы») — then both are counted, in every
 *   state. Hidden rows are returned separately so the screen keeps offering the two buttons
 *   even after arrival — the owner still has to close the manual row as 'replaced'.
 *   A manual row ordered AFTER the China shipment is NOT hidden: it is a later, separate order.
 */
export function factoryOnOrderByArticle(orders: FactoryOrder[], todayIso: string): FactoryOnOrderResult {
  const list = orders || [];
  // Every China row (active or received — a 'replaced' status is a MANUAL-only state, a China
  // row is never 'replaced') is a candidate to hide a manual row of the same article, keyed by
  // article -> the shipping dates of every such row still present in `orders`.
  const chinaOrderedAtByArticle = new Map<string, string[]>();
  for (const o of list) {
    const source = String(o.source || '').trim();
    if (source !== 'Китай' && source !== 'Китай прогноз') continue;
    const article = String(o.article || '').trim();
    if (!article) continue;
    const list2 = chinaOrderedAtByArticle.get(article) || [];
    list2.push(String(o.orderedAt || '').trim());
    chinaOrderedAtByArticle.set(article, list2);
  }

  const qty: Record<string, number> = {};
  const late: Record<string, number> = {};
  const hiddenManual: FactoryOrder[] = [];

  for (const o of list) {
    const status = String(o.status || '').trim();
    if (status === 'received' || status === 'replaced') continue;
    const article = String(o.article || '').trim();
    if (!article) continue;
    const source = String(o.source || '').trim();
    const isChina = source === 'Китай' || source === 'Китай прогноз';
    const expected = String(o.expectedAt || '').trim();

    if (!isChina) {
      const manualOrderedAt = String(o.orderedAt || '').trim();
      const chinaDates = chinaOrderedAtByArticle.get(article) || [];
      const hiddenByChina = chinaDates.some((d) => d >= manualOrderedAt);
      if (hiddenByChina && !o.checked) {
        hiddenManual.push(o);
        continue;
      }
      if (expected && expected < todayIso) continue;
    } else if (expected && expected < todayIso) {
      late[o.id] = daysBetweenIso(expected, todayIso);
    }

    qty[article] = (qty[article] || 0) + (Number(o.qty) || 0);
  }

  return { qty, hiddenManual, late };
}

export interface FactorySignal {
  /** На сколько дней хватит ТРУБЫ: ТРУБА ÷ скорость. */
  daysLeft: number;
  /** ТРУБА, шт: остаток всех кластеров Ozon + Мой склад + заказанное на фабрике и ещё не полученное. */
  pipelineQty: number;
  /** Заказано на фабрике и ещё не получено, шт. Просроченные заказы сюда НЕ входят. */
  onOrderQty: number;
  /** Порог срабатывания в днях: срок поставки + неснижаемый запас. */
  thresholdDays: number;
  /** Тот же порог в штуках: скорость × thresholdDays. */
  thresholdQty: number;
  /** Сколько дозаказать, шт, кратно коробке. 0 — заказывать не нужно. */
  orderQty: number;
  /** Тот же объём в коробках. */
  orderBoxes: number;
  /** Причина сигнала: 'total' — ТРУБА ниже порога; 'clusterDeficit' — ТРУБЫ хватает, но кластерам нужна поставка, а везти нечего. */
  reason: 'total' | 'clusterDeficit';
  /** Непокрытая потребность кластеров, шт. */
  unmetDeficitQty: number;
}

/**
 * Пункт 35. Сигнал «пора заказать на фабрике» по модели ТРУБА.
 * ТРУБА = остаток всех кластеров Ozon + Мой склад + заказанное на фабрике и ещё не полученное.
 * ПОРОГ = скорость × (срок поставки + неснижаемый запас).
 * ОБЪЁМ = скорость × (срок поставки + неснижаемый запас + объём заказа в днях) − ТРУБА,
 * округление вверх до целых коробок один раз по товару.
 * Сигнал больше НЕ гасится наличием заказа: заказ входит в ТРУБУ и уменьшает объём дозаказа.
 * Просроченный заказ в ТРУБУ не входит — вызывающая сторона такие заказы сюда не передаёт.
 * Если ТРУБЫ хватает, но у кластеров есть непокрытая потребность, возвращается reason
 * 'clusterDeficit' с orderQty = 0: товар есть, он просто лежит не в том кластере, заказывать не надо.
 * Остатки исключённых кластеров и строки без КластерID входят в ТРУБУ.
 *
 * Item 86, step C (owner, 26.09.2026): a factory order must ALSO cover the week the goods spend
 * travelling from «Мой склад» to Ozon (settings.deliveryToOzonDays, D) — thresholdDays widens to
 * lead + D + minStockDays. D = 0 reproduces the old threshold exactly.
 */
export function calcFactorySignal(
  totalEstimated: number,
  myStockAvailable: number,
  perDay: number,
  leadTimeDays: number,
  pcsPerBox: number,
  settings: OzonCoverageSettings,
  unmetDeficitQty: number = 0,
  onOrderQty: number = 0
): FactorySignal | null {
  if (!(perDay > 0)) return null;
  const lead = Number(leadTimeDays) || 0;
  const deliveryDays = Math.max(0, Number(settings.deliveryToOzonDays) || 0);
  const onOrder = Math.max(0, Number(onOrderQty) || 0);
  const pipelineQty = totalEstimated + Math.max(0, myStockAvailable) + onOrder;
  const thresholdDays = lead + deliveryDays + settings.minStockDays;
  const thresholdQty = perDay * thresholdDays;
  const belowThreshold = pipelineQty < thresholdQty;
  const unmet = Math.max(0, Number(unmetDeficitQty) || 0);
  if (!belowThreshold && unmet <= 0) return null;
  const box = pcsPerBox > 0 ? pcsPerBox : 1;
  const targetQty = perDay * (thresholdDays + settings.factoryOrderDays);
  const rawNeed = targetQty - pipelineQty;
  const orderQty = belowThreshold && rawNeed > 0 ? Math.ceil(rawNeed / box) * box : 0;
  return {
    daysLeft: pipelineQty / perDay,
    pipelineQty,
    onOrderQty: onOrder,
    thresholdDays,
    thresholdQty,
    orderQty,
    orderBoxes: Math.ceil(orderQty / box),
    reason: belowThreshold ? 'total' : 'clusterDeficit',
    unmetDeficitQty: unmet
  };
}

export interface ClusterCoverageRow {
  clusterId: string;
  clusterName: string;
  qtySold: number;
  perDay: number;
  available: number;
  transit: number;
  returns: number;
  /** Item 85. Shelf + on their way: what the cluster can count on. Coverage and need use it. */
  estimated: number;
  coverageDays: number | null;
  excluded: boolean;
  /** Кластер отмечен как приоритетный. */
  priority: boolean;
  /** Коэффициент повышенного запаса приоритетного кластера (1 — обычный кластер). */
  priorityK: number;
  /** Непокрытая потребность кластера, шт: сколько не досталось из-за нехватки на Моём складе. */
  unmetQty: number;
  /** Item 85. On their way by our own supplies (status before acceptance at the storage warehouse), шт. */
  pendingQty: number;
  /** «В заявках» по данным Ozon для этого кластера, шт. */
  requestedQty: number;
  /** Item 85. On their way by Ozon: «В пути» + «В заявках», шт. */
  ozonInFlightQty: number;
  /** Item 85. On their way, counted once: the larger of pendingQty and ozonInFlightQty, шт. */
  inFlightQty: number;
  recommendation: SupplyRecommendation | null;
  /** Item 86, step B. Share (%) of the article's sales over `shareWindowWeeks` this cluster took
   *  in the LONG share window — the multiplier behind `perDay` (= article speed × this share). */
  speedSharePct: number;
  /** Item 86, step B. Length of the share window, weeks (full weeks, +1 for a part-week). */
  shareWindowWeeks: number;
}

export interface ArticleCoverage {
  article: string;
  qtySold: number;
  /** ФАКТИЧЕСКАЯ скорость продаж, шт/день. Тренд её не трогает: по ней считаются кластеры. */
  perDay: number;
  /** Пункт 38 / item 85 step 1.4. Прогнозная скорость для заказа на фабрике:
   *  max(window speed × trend, 7-day speed when «Спрос вырос» fired) × (1 + прирост, %). */
  forecastPerDay: number;
  /** Пункт 38. Разбор тренда продаж. null — тренд не считался (продаж за окно нет). */
  trend: SalesTrend | null;
  pcsPerBox: number;
  leadTimeDays: number;
  myStockAvailable: number;
  totalEstimated: number;
  unboundEstimated: number;
  /** Продажи товара, не привязанные к кластеру («Без кластера» и неизвестные названия), шт. */
  unboundQtySold: number;
  /** Суммарная непокрытая потребность кластеров товара, шт. */
  unmetDeficitQty: number;
  /** Весь локальный зачёт по товару, шт (включая позиции без кластера). */
  pendingTotal: number;
  /** Свободный остаток Моего склада после резерва под созданные заявки, шт. Item 85, step 1.6:
   *  the reserve is taken per PHYSICAL article, so a kit's reserve of shared bottles lowers every
   *  other kit (and the bottles themselves) too. */
  freeMyStock: number;
  /** Item 85, step 1.6. What the recommendation may hand out: freeMyStock, cut further when a
   *  component shared with other kits is short and is split between them. */
  shippableMyStock: number;
  /** Item 85, step 1.6. Shared components whose split cut this article below its free stock. */
  sharedLimitedBy: string[];
  clusters: ClusterCoverageRow[];
  factory: FactorySignal | null;
  /** Пункт 42. Разбор коррекции скорости при дефиците. null — коррекция не применялась. */
  speedCorrection: SpeedCorrectionInfo | null;
  /** Item 73. The last 7 days against the speed window. null — no base speed or no sales rows for the last 7 days. */
  demandGrowth: DemandGrowthInfo | null;
}

/**
 * Готовый локальный зачёт по созданным заявкам (пункт 23).
 * Структура повторяет PendingSuppliesResult из ozonPending.ts, но объявлена здесь отдельно:
 * прямой импорт создал бы кольцевую зависимость между модулями.
 */
export interface OzonPendingLike {
  /** On their way to a cluster: артикул -> КластерID -> шт. */
  byArticleCluster: Record<string, Record<string, number>>;
  /** Reserve of «Мой склад» по товару целиком, шт (включая позиции без кластера). */
  byArticle: Record<string, number>;
  /** Item 85. On their way without КластерID: артикул -> шт. Absent — none. */
  unboundInFlightByArticle?: Record<string, number>;
}

// ===== Пункт 36: компоненты виртуальных комплектов =====

/**
 * Покрытие по одному компоненту виртуальных комплектов.
 * У фабрики заказывают не комплекты, а компоненты: сроки поставки и размеры коробок у них
 * свои, а один компонент может входить сразу в несколько комплектов и расходоваться кратно
 * быстрее. Поэтому сигнал заказа на фабрике считается здесь, а не по комплекту.
 */
export interface ComponentCoverage {
  /** Артикул компонента. */
  component: string;
  /** Скорость расхода, шт/день: Σ по комплектам (скорость комплекта × норма расхода). */
  perDay: number;
  /** Пункт 38. Прогнозная скорость расхода: то же, но по ПРОГНОЗНОЙ скорости комплектов. */
  forecastPerDay: number;
  /** ТРУБА, шт: fromKitsQty + Мой склад + заказанное на фабрике по этому компоненту. */
  pipelineQty: number;
  /** Собственный остаток компонента на Моём складе, шт (сырой, без вычета резервов). */
  myStockQty: number;
  /** Зарезервировано под созданные заявки на поставку, шт: Σ по комплектам (резерв комплекта × норма). */
  reservedQty: number;
  /** Свободный остаток на Моём складе, шт: myStockQty − reservedQty, не меньше нуля. */
  freeMyStockQty: number;
  /** Заказано на фабрике по самому компоненту и ещё не получено, шт. */
  onOrderQty: number;
  /** Пришло из расчётных остатков комплектов на Ozon, шт: Σ (totalEstimated комплекта × норма). */
  fromKitsQty: number;
  /** Срок поставки из карточки КОМПОНЕНТА в SKU Базе, дней. */
  leadTimeDays: number;
  /** Размер коробки из карточки КОМПОНЕНТА в SKU Базе, шт. */
  pcsPerBox: number;
  /** Сигнал «пора заказать на фабрике» по компоненту. */
  factory: FactorySignal | null;
  /** Артикулы виртуальных комплектов, в которые входит компонент. */
  usedInKits: string[];
}

/** Узкое место виртуального комплекта — компонент с наименьшим покрытием в днях. */
export interface KitBottleneck {
  kitSku: string;
  /** Артикул компонента с наименьшим покрытием. */
  componentSku: string;
  /** Покрытие узкого места, дней. null — скорость расхода 0, покрытие «бесконечное». */
  daysLeft: number | null;
  /** Сколько комплектов можно собрать прямо сейчас: min floor(СВОБОДНЫЙ остаток компонента ÷ норма). */
  canAssembleQty: number;
}

export interface OzonCoverageInput {
  stocks: OzonStockRow[];
  sales: OzonSalesRow[];
  skus: SKUItem[];
  clusters: OzonClusterRef[];
  settings: OzonCoverageSettings;
  /** Доступность на Моём складе по артикулу (виртуальные комплекты уже учтены вызывающей стороной). */
  myStockAvailability: Record<string, number>;
  /** Локальный зачёт по созданным заявкам; не передан — расчёт идёт как раньше. */
  pending?: OzonPendingLike;
  /** Пункт 35. Заказано на фабрике и ещё не получено, шт по артикулу. Просроченные заказы сюда не попадают. */
  factoryOnOrder?: Record<string, number>;
  /** Пункт 36. Состав комплектов; не передан — расчёт по компонентам не выполняется. */
  kits?: KitItem[];
  /** Момент расчёта; по умолчанию — текущее время. */
  now?: Date;
}

export interface OzonCoverageResult {
  speed: SalesSpeedResult;
  articles: ArticleCoverage[];
  /** Пункт 36. Покрытие по компонентам виртуальных комплектов. Без input.kits — пустой массив. */
  components: ComponentCoverage[];
  /** Пункт 36. Узкие места виртуальных комплектов. Без input.kits — пустой массив. */
  bottlenecks: KitBottleneck[];
  /** Пункт 38. Тренд продаж по артикулу. */
  trends: Record<string, SalesTrend>;
}

/** Пункт 42. Разбор коррекции скорости по одному товару. */
export interface SpeedCorrectionInfo {
  /** Скорость до коррекции, шт/день. */
  base: number;
  /** Скорость после коррекции, шт/день. */
  corrected: number;
  /** Во сколько раз выросла скорость. При базе 0 равен 0. */
  factor: number;
  /** Скорость по лучшим неделям до применения предела роста, шт/день. */
  raw: number;
  /** Предел роста сработал и обрезал коррекцию. */
  capped: boolean;
  /** Продано за окно тренда, шт. */
  windowQty: number;
  /** Недель с продажами в окне тренда. */
  weeksWithSales: number;
  /** Фактическая длина окна тренда, недель (может быть меньше настройки). */
  windowWeeks: number;
  /** На сколько дней хватало остатка Ozon по старой скорости. При базе 0 равен 0. */
  daysLeft: number;
  /** Лучшие недели окна: понедельник и количество. */
  bestWeeks: { week: string; qty: number }[];
}

/** Пункт 42. Минимум недель с продажами в окне тренда: защита от новинок. */
export const MIN_WEEKS_WITH_SALES = 6;

/**
 * Пункт 42. Коррекция скорости продаж при дефиците.
 * Скорость за 4 последние недели не отличает падение спроса от отсутствия товара:
 * у распроданного артикула она занижена в разы, а от неё считаются порог заказа,
 * потребность кластеров и отсекатель maxClusterDays.
 * Признак дефицита — ПУСТОЙ СКЛАД, а не падение продаж: если остатка Ozon
 * (доступно + в пути) хватает меньше чем на deficitDays, скорость берётся как среднее
 * по bestWeeks лучшим неделям окна тренда.
 * Скорость 0 при нулевом остатке — тоже дефицит: делить на ноль нельзя, товар считается
 * распроданным, а предел роста к нулю неприменим и не действует.
 * Защита от новинок и случайных всплесков: минимум minSalesForCorrection штук за окно
 * и минимум MIN_WEEKS_WITH_SALES недель с продажами.
 * В окно берутся только недельные строки («Дней» = 7): 28-дневные блоки архива дали бы
 * четырёхкратно завышенную «неделю».
 * Пункт 39A: артикул продаж разрешается через ту же карту offer_id, что и в buildSalesSpeed,
 * иначе скорость и её коррекция считались бы по разным артикулам.
 * Функция ИЗМЕНЯЕТ переданный объект speed и возвращает разбор по скорректированным товарам.
 */
export function applyDeficitSpeedCorrection(
  speed: SalesSpeedResult,
  stocks: OzonStockRow[],
  sales: OzonSalesRow[],
  skus: SKUItem[],
  settings: OzonCoverageSettings,
  now: Date,
  offerIdToArticle?: Record<string, string>
): Record<string, SpeedCorrectionInfo> {
  const out: Record<string, SpeedCorrectionInfo> = {};
  const deficitDays = Number(settings.deficitDays);
  if (!(deficitDays > 0)) return out;
  const trendWeeks = Number(settings.trendWeeks) > 0 ? Math.floor(Number(settings.trendWeeks)) : 13;
  const bestWeeksN = Number(settings.bestWeeks) > 0 ? Math.floor(Number(settings.bestWeeks)) : 4;
  const minSales = Number(settings.minSalesForCorrection) >= 0 ? Number(settings.minSalesForCorrection) : 50;
  const maxGrowth = Number(settings.maxSpeedGrowth);

  // Остаток Ozon по товару: доступно + в пути. Возвраты не берутся: их ещё нет в продаже.
  const onHand: Record<string, number> = {};
  for (const row of stocks) {
    const article = resolveOzonArticle(skus, row.offerId, row.sku);
    onHand[article] = (onHand[article] || 0) + (Number(row.available) || 0) + (Number(row.transit) || 0);
  }

  // Окно тренда обрезается по неделям, которые реально пришли с сервера.
  const presentWeeks = new Set<string>();
  for (const row of sales) {
    if ((Number(row.days) || 0) === 7) presentWeeks.add(String(row.week || '').trim());
  }
  const window = getLastFullWeeks(now, trendWeeks).filter(w => presentWeeks.has(w));
  if (window.length < MIN_WEEKS_WITH_SALES) return out;
  const windowSet = new Set(window);

  // Недельный ряд по товару и по товару с кластером.
  const byWeek: Record<string, Record<string, number>> = {};
  const byCluster: Record<string, Record<string, number>> = {};
  for (const row of sales) {
    if ((Number(row.days) || 0) !== 7) continue;
    const week = String(row.week || '').trim();
    if (!windowSet.has(week)) continue;
    const qty = Number(row.qty) || 0;
    if (!(qty > 0)) continue;
    const article = resolveSalesArticle(skus, row.offerId, offerIdToArticle);
    if (!byWeek[article]) byWeek[article] = {};
    byWeek[article][week] = (byWeek[article][week] || 0) + qty;
    const cluster = String(row.clusterName || '').trim();
    if (!cluster) continue;
    if (!byCluster[article]) byCluster[article] = {};
    byCluster[article][cluster] = (byCluster[article][cluster] || 0) + qty;
  }

  const candidates = new Set<string>([...Object.keys(speed.perDayByArticle), ...Object.keys(byWeek)]);
  for (const article of candidates) {
    const base = Number(speed.perDayByArticle[article]) || 0;
    const stock = onHand[article] || 0;
    let daysLeft = 0;
    if (base > 0) {
      daysLeft = stock / base;
      if (daysLeft >= deficitDays) continue;
    } else if (stock > 0) {
      continue; // скорость 0 при живом остатке — это не дефицит, а отсутствие спроса
    }

    const weekQty = byWeek[article] || {};
    const values = window.map(w => weekQty[w] || 0);
    const weeksWithSales = values.filter(v => v > 0).length;
    if (weeksWithSales < MIN_WEEKS_WITH_SALES) continue;
    const windowQty = values.reduce((sum, v) => sum + v, 0);
    if (windowQty < minSales) continue;

    const ranked = window.map(w => ({ week: w, qty: weekQty[w] || 0 }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, bestWeeksN);
    if (!ranked.length) continue;
    const raw = ranked.reduce((sum, r) => sum + r.qty, 0) / ranked.length / 7;
    if (!(raw > base)) continue;

    // Предел роста применяется только к ненулевой базе: 5 × 0 = 0 обнулило бы коррекцию.
    const capApplies = base > 0 && maxGrowth >= 1;
    const corrected = capApplies ? Math.min(raw, base * maxGrowth) : raw;

    speed.perDayByArticle[article] = corrected;
    const clusterSpeeds = speed.perDayByArticleCluster[article];
    if (base > 0 && clusterSpeeds) {
      const factor = corrected / base;
      for (const name of Object.keys(clusterSpeeds)) clusterSpeeds[name] = clusterSpeeds[name] * factor;
    } else {
      // Базы нет: кластерные скорости строятся заново по долям продаж за окно тренда.
      const clusterQty = byCluster[article] || {};
      let total = 0;
      for (const name of Object.keys(clusterQty)) total += clusterQty[name];
      const fresh: Record<string, number> = {};
      if (total > 0) {
        for (const name of Object.keys(clusterQty)) fresh[name] = corrected * (clusterQty[name] / total);
      }
      speed.perDayByArticleCluster[article] = fresh;
    }

    out[article] = {
      base,
      corrected,
      factor: base > 0 ? corrected / base : 0,
      raw,
      capped: capApplies && corrected < raw,
      windowQty,
      weeksWithSales,
      windowWeeks: window.length,
      daysLeft,
      bestWeeks: ranked
    };
  }
  return out;
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

// ===== Item 73: demand growth over the last 7 days =====

/** Item 73. Fewer pieces than this in the last 7 days is noise, not a signal. */
export const DEMAND_GROWTH_MIN_QTY = 10;

export interface DemandGrowthInfo {
  /** Sold in the last 7 days, pcs: the current week by its elapsed days plus the matching tail of the previous full week. */
  recentQty: number;
  /** recentQty / 7, pcs/day. */
  recentPerDay: number;
  /** Elapsed days of the current week that entered the 7 days (0 — only the previous full week). */
  currentWeekDays: number;
  /** The window speed the 7 days are compared with, pcs/day (after the deficit corrections). */
  basePerDay: number;
  /** (recentPerDay / basePerDay − 1) × 100; negative when sales fell. */
  growthPct: number;
  thresholdPct: number;
  /** The threshold was crossed and the speeds of the article and its clusters were raised to recentPerDay. */
  applied: boolean;
}

export interface RecentSpeedResult {
  currentWeekDays: number;
  qtyByArticle: Record<string, number>;
}

/**
 * Item 73. Sales of the last 7 days per article. The current week is a part-week of
 * `currentWeekDays` days (item 71); the remaining 7 − currentWeekDays days are taken from
 * the previous full week pro rata. Without a part-week row the last full week stands for
 * the 7 days as a whole.
 */
export function buildRecentSpeed(
  sales: OzonSalesRow[],
  skus: SKUItem[],
  now: Date,
  offerIdToArticle?: Record<string, string>
): RecentSpeedResult {
  const current = getMskWeekMonday(now);
  const previous = getLastFullWeeks(now, 1)[0] || '';
  let currentWeekDays = 0;
  for (const row of sales) {
    if (String(row.week || '').trim() !== current) continue;
    const days = Number(row.days) || 0;
    if (days > 0 && days < 7 && days > currentWeekDays) currentWeekDays = days;
  }
  const previousShare = (7 - currentWeekDays) / 7;

  const qtyByArticle: Record<string, number> = {};
  for (const row of sales) {
    const week = String(row.week || '').trim();
    const days = Number(row.days) || 0;
    let share = 0;
    if (week === current && currentWeekDays > 0 && days < 7) share = 1;
    else if (week === previous && days === 7) share = previousShare;
    if (share <= 0) continue;
    const qty = Number(row.qty) || 0;
    if (qty === 0) continue;
    const article = resolveSalesArticle(skus, row.offerId, offerIdToArticle);
    qtyByArticle[article] = (qtyByArticle[article] || 0) + qty * share;
  }
  return { currentWeekDays, qtyByArticle };
}

/**
 * Item 73. Compares the last 7 days with the window speed and, above the threshold, raises
 * the speed of the article and of every cluster of it to the recent one (same factor for
 * all clusters: the 7 days carry no reliable per-cluster split). Runs AFTER the deficit
 * corrections, so a lifted speed is the base and is not lifted twice.
 * The function CHANGES the passed speed object and returns the breakdown per article.
 */
export function applyDemandGrowth(
  speed: SalesSpeedResult,
  recent: RecentSpeedResult,
  settings: OzonCoverageSettings
): Record<string, DemandGrowthInfo> {
  const out: Record<string, DemandGrowthInfo> = {};
  const thresholdPct = Number(settings.demandGrowthPct) > 0 ? Number(settings.demandGrowthPct) : 0;
  for (const article of Object.keys(recent.qtyByArticle)) {
    const basePerDay = Number(speed.perDayByArticle[article]) || 0;
    if (!(basePerDay > 0)) continue;
    const recentQty = recent.qtyByArticle[article];
    const recentPerDay = recentQty / 7;
    // Rounded to 0.01 %: 91 / 7 against 10 a day is exactly +30 %, not +30.000000000000004.
    const growthPct = Math.round((recentPerDay / basePerDay - 1) * 10000) / 100;
    const applied = thresholdPct > 0 && recentQty >= DEMAND_GROWTH_MIN_QTY && growthPct > thresholdPct;
    if (applied) {
      const factor = recentPerDay / basePerDay;
      speed.perDayByArticle[article] = recentPerDay;
      const clusterSpeeds = speed.perDayByArticleCluster[article];
      if (clusterSpeeds) {
        for (const name of Object.keys(clusterSpeeds)) clusterSpeeds[name] = clusterSpeeds[name] * factor;
      }
    }
    out[article] = {
      recentQty,
      recentPerDay,
      currentWeekDays: recent.currentWeekDays,
      basePerDay,
      growthPct,
      thresholdPct,
      applied
    };
  }
  return out;
}

// ===== Пункт 38: тренд продаж =====

/**
 * Недель в месяце. Наклон регрессии измеряется в шт/неделю, а множитель нужен месячный:
 * именно так формула была восстановлена сверкой с замером 09.08.2026.
 */
const WEEKS_PER_MONTH = 4.345;

/** Пункт 38. Нижняя граница применённого тренда. */
const TREND_MIN = 0.7;

/** Пункт 38. Верхняя граница применённого тренда. */
const TREND_MAX = 1.5;

/**
 * Пункт 38. Минимум продаж за окно тренда, шт: на мелкой выборке наклон регрессии — шум
 * (в замере 09.08.2026 Этажерка_25_белая давала +95% на выборке в 23 штуки).
 * Порог из решения пользователя 09.08.2026, отдельной настройки для него намеренно не заводится.
 */
export const MIN_SALES_FOR_TREND = 50;

export interface SalesTrend {
  /** Сырой множитель до фильтров. */
  raw: number;
  /** Применённый множитель: 1.00, если сработал любой фильтр. */
  applied: number;
  /** Почему множитель отличается от сырого: null — фильтры не срабатывали. */
  reason: 'correction' | 'zeroWeek' | 'fewSales' | 'deficit' | 'clamped' | 'shortWindow' | null;
  /** Недельный ряд, по которому считался тренд (для подсказки в интерфейсе). */
  weeks: string[];
  weekQty: number[];
  /** Всего продано за окно, шт. */
  windowQty: number;
  /** Наклон регрессии, шт/неделю. */
  slope: number;
  /** Среднее за окно, шт/неделю. */
  mean: number;
  /** Сколько недель окна с нулевыми продажами. */
  zeroWeeks: number;
}

/**
 * Пункт 38. Тренд продаж по каждому товару.
 * Скорость за окно — плоское среднее, оно не видит направления спроса, а горизонт заказа
 * на фабрике около 110 дней, поэтому партия систематически расходится с реальностью.
 * По недельному ряду за окно строится линейная регрессия методом наименьших квадратов,
 * тренд = (среднее + наклон × WEEKS_PER_MONTH) ÷ среднее.
 * Окно и правила сборки ряда те же, что у коррекции скорости: берутся только недельные
 * строки («Дней» = 7), а окно урезается по неделям, реально пришедшим с сервера.
 * ФИЛЬТРЫ применяются строго по порядку, первый сработавший даёт множитель 1.00:
 * 1) короткое окно — меньше MIN_WEEKS_WITH_SALES недель с данными, тренд считать не на чем;
 * 2) сработала коррекция скорости при дефиците (пункт 42) — решение пользователя 19.08.2026:
 *    коррекция и тренд поднимают скорость одним и тем же способом, перемножение их пределов
 *    5× и 1,5× дало бы рост в 7,5 раза и затоваривание;
 * 3) в окне есть неделя с нулевыми продажами — это чаще старт продаж или отсутствие товара,
 *    а не спрос (в замере Миска_двойная получала +71% из-за пяти нулевых недель на старте);
 * 4) за окно продано меньше MIN_SALES_FOR_TREND штук — выборка слишком мелкая;
 * 5) товар в дефиците И тренд понижающий — падение продаж неотличимо от отсутствия товара.
 *    ПОВЫШАЮЩИЙ тренд при дефиците применяется как обычно.
 * Если не сработал ни один фильтр, тренд ограничивается диапазоном TREND_MIN…TREND_MAX.
 * Функция чистая: входные объекты не изменяются.
 */
export function buildSalesTrend(
  sales: OzonSalesRow[],
  skus: SKUItem[],
  settings: OzonCoverageSettings,
  now: Date,
  speed: SalesSpeedResult,
  stocks: OzonStockRow[],
  corrections: Record<string, SpeedCorrectionInfo>,
  offerIdToArticle?: Record<string, string>
): Record<string, SalesTrend> {
  const trendWeeks = Number(settings.trendWeeks) > 0 ? Math.floor(Number(settings.trendWeeks)) : 13;
  const deficitDays = Number(settings.deficitDays) > 0 ? Number(settings.deficitDays) : 0;

  // Остаток Ozon по товару: доступно + в пути, как в applyDeficitSpeedCorrection.
  const onHand: Record<string, number> = {};
  for (const row of stocks) {
    const article = resolveOzonArticle(skus, row.offerId, row.sku);
    onHand[article] = (onHand[article] || 0) + (Number(row.available) || 0) + (Number(row.transit) || 0);
  }

  // Окно тренда обрезается по неделям, которые реально пришли с сервера.
  const presentWeeks = new Set<string>();
  for (const row of sales) {
    if ((Number(row.days) || 0) === 7) presentWeeks.add(String(row.week || '').trim());
  }
  const window = getLastFullWeeks(now, trendWeeks).filter(w => presentWeeks.has(w));
  const windowSet = new Set(window);

  // Недельный ряд по товару. Пункт 39A: артикул разрешается через ту же карту offer_id,
  // что и в buildSalesSpeed и applyDeficitSpeedCorrection, — иначе тренд считался бы по
  // артикулу, отличному от артикула скорости, и множитель применился бы не к тому товару.
  const byWeek: Record<string, Record<string, number>> = {};
  for (const row of sales) {
    if ((Number(row.days) || 0) !== 7) continue;
    const week = String(row.week || '').trim();
    if (!windowSet.has(week)) continue;
    const qty = Number(row.qty) || 0;
    if (!(qty > 0)) continue;
    const article = resolveSalesArticle(skus, row.offerId, offerIdToArticle);
    if (!byWeek[article]) byWeek[article] = {};
    byWeek[article][week] = (byWeek[article][week] || 0) + qty;
  }

  const out: Record<string, SalesTrend> = {};
  const candidates = new Set<string>([...Object.keys(speed.perDayByArticle), ...Object.keys(byWeek)]);
  for (const article of candidates) {
    const weekQtyMap = byWeek[article] || {};
    const weekQty = window.map(w => weekQtyMap[w] || 0);
    const windowQty = weekQty.reduce((sum, v) => sum + v, 0);
    const zeroWeeks = weekQty.filter(v => v === 0).length;
    const mean = weekQty.length > 0 ? windowQty / weekQty.length : 0;

    // Наклон методом наименьших квадратов, x — порядковый номер недели от 0.
    let slope = 0;
    if (weekQty.length > 1) {
      const meanX = (weekQty.length - 1) / 2;
      let cov = 0;
      let varX = 0;
      for (let i = 0; i < weekQty.length; i++) {
        cov += (i - meanX) * (weekQty[i] - mean);
        varX += (i - meanX) * (i - meanX);
      }
      slope = varX > 0 ? cov / varX : 0;
    }
    // Среднее 0 — делить не на что, движения спроса нет.
    const raw = mean > 0 ? (mean + slope * WEEKS_PER_MONTH) / mean : 1;

    // Дефицит определяется так же, как в applyDeficitSpeedCorrection: пустой склад, а не
    // падение продаж. Скорость 0 при нулевом остатке — тоже дефицит, делить на ноль нельзя.
    const perDay = Number(speed.perDayByArticle[article]) || 0;
    const stock = onHand[article] || 0;
    const inDeficit = deficitDays > 0 && (perDay > 0 ? stock / perDay < deficitDays : stock <= 0);

    let reason: SalesTrend['reason'] = null;
    let applied = 1;
    if (window.length < MIN_WEEKS_WITH_SALES) {
      reason = 'shortWindow';
    } else if (corrections[article]) {
      reason = 'correction';
    } else if (zeroWeeks > 0) {
      reason = 'zeroWeek';
    } else if (windowQty < MIN_SALES_FOR_TREND) {
      reason = 'fewSales';
    } else if (inDeficit && raw < 1) {
      reason = 'deficit';
    } else {
      applied = Math.min(TREND_MAX, Math.max(TREND_MIN, raw));
      if (applied !== raw) reason = 'clamped';
    }

    out[article] = { raw, applied, reason, weeks: window, weekQty, windowQty, slope, mean, zeroWeeks };
  }
  return out;
}

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
  const speedCorrections = applyDeficitSpeedCorrection(speed, input.stocks, input.sales, input.skus, input.settings, now, offerIdToArticle);
  // Item 73. The last 7 days against the window: above the threshold the larger speed wins.
  const demandGrowth = applyDemandGrowth(speed, buildRecentSpeed(input.sales, input.skus, now, offerIdToArticle), input.settings);
  // Item 86, step B. AFTER every article-level pass: split the (corrected) article speed between
  // its clusters by their share of sales over the longer share window, replacing item 72's
  // per-cluster deficit lift (two lifts of one empty cluster would have overstocked it).
  const trendWeeksForShare = Number(input.settings.trendWeeks) > 0 ? Math.floor(Number(input.settings.trendWeeks)) : 13;
  const shareWindow = buildClusterShareWindow(input.sales, input.skus, Math.max(trendWeeksForShare, speedWeeks), now, offerIdToArticle);
  const clusterSharesPctByArticle = rebuildClusterSpeedByShare(speed, shareWindow);
  // Пункт 38. Тренд считается ПОСЛЕ коррекции скорости: сработавшая коррекция гасит тренд.
  const trends = buildSalesTrend(input.sales, input.skus, input.settings, now, speed, input.stocks, speedCorrections, offerIdToArticle);
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
  const nameToId = buildClusterNameToId(input.clusters);
  const excludedIds = parseExcludedClusters(input.settings.excludedClusters);
  const priorityMap = parsePriorityClusters(input.settings.priorityClusters || '');

  const articleSet = new Set<string>([
    ...Object.keys(stocksByArticle),
    ...Object.keys(speed.qtyByArticle)
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
      demandGrowth: demandGrowth[article] || null
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

