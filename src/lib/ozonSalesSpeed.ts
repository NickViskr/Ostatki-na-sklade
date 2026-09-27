// Item 88, ticket 02. Sales speed: MSK weeks, article resolution, deficit correction, demand growth.
import { OzonSalesRow, OzonStockRow, SKUItem } from '../types';
import type { OzonCoverageSettings } from './ozonClusters';

export const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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
 *
 * Item 86, step D (owner, 26.09.2026): an article whose speed for this same window already came
 * from history (`speedSource` 'daysInStock' or 'lookback') is passed in `skipArticles` and is
 * left untouched — history already tells stock-out from slow demand, so the old empty-stock
 * heuristic below must not override it.
 */
export function applyDeficitSpeedCorrection(
  speed: SalesSpeedResult,
  stocks: OzonStockRow[],
  sales: OzonSalesRow[],
  skus: SKUItem[],
  settings: OzonCoverageSettings,
  now: Date,
  offerIdToArticle?: Record<string, string>,
  skipArticles?: Set<string>
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
    if (skipArticles && skipArticles.has(article)) continue;
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
