// Item 88, ticket 02. Item 38 sales trend, plain and history-aware (item 86 step D).
import { OzonSalesRow, OzonStockRow, SKUItem } from '../types';
import { MIN_WEEKS_WITH_SALES, getLastFullWeeks, resolveOzonArticle, resolveSalesArticle } from './ozonSalesSpeed';
import type { SalesSpeedResult, SpeedCorrectionInfo } from './ozonSalesSpeed';
import type { OzonCoverageSettings } from './ozonClusters';
import { historyArticleFraction, historyWindowForArticle } from './ozonStockHistory';
import type { ArticleHistorySpeedInfo, StockHistoryContext } from './ozonStockHistory';

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
  reason: 'correction' | 'zeroWeek' | 'fewSales' | 'deficit' | 'clamped' | 'shortWindow' | 'lookback' | null;
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
  /** Item 86, step D: the trend window is fully covered by stock history, so the weekly series
   *  above is r(w) = qty(w) ÷ f(w) (days-in-stock rate), not raw calendar-week quantities. */
  historyBased?: boolean;
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
 * Item 86, step D, definition 5. Overrides `buildSalesTrend`'s baseline for articles history
 * speaks for — a shorter covered SPEED window does not imply the longer TREND window is covered
 * too, so this is checked independently, over `trendWeeks` full weeks (no current part-week: the
 * trend never counted it).
 *
 * A 'lookback' article (long absent) gets trend 1 outright, reason 'lookback' — a trend line
 * cannot be trusted when the article barely sold at all.
 *
 * Otherwise, when the trend window is fully covered: weekly rate r(w) = qty(w) ÷ f(w), using
 * ONLY weeks with 7 × f(w) ≥ 3 days (fewer than half a week in stock is too thin a sample to
 * rate); a usable week with 0 sales STAYS in the regression — that is real zero demand, not a
 * missing week, replacing the old «any zero week disqualifies the trend» filter (it used to read
 * a stock-out's own zero weeks as «too early to trend», e.g. Миска_двойная's ×2.09).
 * `windowQty`/`zeroWeeks` still report the ACTUAL pieces sold — MIN_SALES_FOR_TREND and the
 * deficit/clamp rules read those real, unscaled numbers, unchanged from `buildSalesTrend`.
 * Fewer than MIN_WEEKS_WITH_SALES usable weeks → 'shortWindow' (same threshold, now counting
 * USABLE weeks rather than weeks with a sale).
 * A window NOT fully covered by history keeps `buildSalesTrend`'s own baseline result — today's
 * calculation, unchanged.
 */
export function buildSalesTrendWithHistory(
  sales: OzonSalesRow[],
  skus: SKUItem[],
  settings: OzonCoverageSettings,
  now: Date,
  speed: SalesSpeedResult,
  stocks: OzonStockRow[],
  corrections: Record<string, SpeedCorrectionInfo>,
  historyCtx: StockHistoryContext,
  historySpeedInfo: Record<string, ArticleHistorySpeedInfo>,
  offerIdToArticle?: Record<string, string>
): Record<string, SalesTrend> {
  const out = buildSalesTrend(sales, skus, settings, now, speed, stocks, corrections, offerIdToArticle);

  const trendWeeks = Number(settings.trendWeeks) > 0 ? Math.floor(Number(settings.trendWeeks)) : 13;
  const deficitDays = Number(settings.deficitDays) > 0 ? Number(settings.deficitDays) : 0;
  const weeks = getLastFullWeeks(now, trendWeeks);

  const onHand: Record<string, number> = {};
  for (const row of stocks) {
    const article = resolveOzonArticle(skus, row.offerId, row.sku);
    onHand[article] = (onHand[article] || 0) + (Number(row.available) || 0) + (Number(row.transit) || 0);
  }

  // Weekly sales («Дней» = 7), per article — needed to look up qty(w) of an arbitrary week
  // regardless of whether the OLD sales-presence filter would have kept it.
  const weeklyQty: Record<string, Record<string, number>> = {};
  for (const row of sales) {
    if ((Number(row.days) || 0) !== 7) continue;
    const week = String(row.week || '').trim();
    const article = resolveSalesArticle(skus, row.offerId, offerIdToArticle);
    if (!weeklyQty[article]) weeklyQty[article] = {};
    weeklyQty[article][week] = (weeklyQty[article][week] || 0) + (Number(row.qty) || 0);
  }

  // The trend window (trendWeeks) is generally LONGER than the speed window, so an article can
  // be covered here without being in `historySpeedInfo` at all (its speedWeeks window uncovered,
  // or `historySpeedInfo` empty because the caller has no stockHistory) — every candidate article
  // is checked, not just the ones history already spoke for at the speed level.
  const candidates = new Set<string>([...Object.keys(historySpeedInfo), ...Object.keys(weeklyQty), ...Object.keys(speed.perDayByArticle)]);
  for (const article of candidates) {
    const info = historySpeedInfo[article];
    if (info && info.source === 'lookback') {
      out[article] = { raw: 1, applied: 1, reason: 'lookback', weeks: [], weekQty: [], windowQty: 0, slope: 0, mean: 0, zeroWeeks: 0 };
      continue;
    }

    const win = historyWindowForArticle(historyCtx, article, weeks, null, 0);
    if (!win.covered) continue; // baseline (today's calculation) stands

    const usableWeeks: string[] = [];
    const rateSeries: number[] = [];
    let windowQty = 0;
    let zeroWeeks = 0;
    for (const w of weeks) {
      const f = historyArticleFraction(historyCtx, article, w);
      const rawQty = (weeklyQty[article] && weeklyQty[article][w]) || 0;
      windowQty += rawQty;
      if (rawQty === 0) zeroWeeks++;
      if (7 * f < 3) continue; // too little of the week in stock to rate
      usableWeeks.push(w);
      rateSeries.push(rawQty / f);
    }

    let reason: SalesTrend['reason'] = null;
    let raw = 1;
    let slope = 0;
    let mean = 0;
    if (usableWeeks.length < MIN_WEEKS_WITH_SALES) {
      reason = 'shortWindow';
    } else {
      mean = rateSeries.reduce((s, v) => s + v, 0) / rateSeries.length;
      const meanX = (rateSeries.length - 1) / 2;
      let cov = 0;
      let varX = 0;
      for (let i = 0; i < rateSeries.length; i++) {
        cov += (i - meanX) * (rateSeries[i] - mean);
        varX += (i - meanX) * (i - meanX);
      }
      slope = varX > 0 ? cov / varX : 0;
      raw = mean > 0 ? (mean + slope * WEEKS_PER_MONTH) / mean : 1;

      const perDay = Number(speed.perDayByArticle[article]) || 0;
      const stock = onHand[article] || 0;
      const inDeficit = deficitDays > 0 && (perDay > 0 ? stock / perDay < deficitDays : stock <= 0);

      if (corrections[article]) {
        reason = 'correction';
      } else if (windowQty < MIN_SALES_FOR_TREND) {
        reason = 'fewSales';
      } else if (inDeficit && raw < 1) {
        reason = 'deficit';
      }
    }

    let applied = 1;
    if (!reason) {
      applied = Math.min(TREND_MAX, Math.max(TREND_MIN, raw));
      if (applied !== raw) reason = 'clamped';
    }

    out[article] = { raw, applied, reason, weeks: usableWeeks, weekQty: rateSeries, windowQty, slope, mean, zeroWeeks, historyBased: true };
  }

  return out;
}
